// Service discovery: an orders service calls a payment service whose instances scale and crash. Deterministic, integers only.
// One step is 1 second. Instances register with a lease (TTL 30 s) and renew it with a heartbeat every 10 s. Orders sends 30
// requests per second, round-robin over the payment addresses it currently knows. A call to an address whose instance is gone fails.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const int Horizon = 600, Rate = 30;
    const int Ttl = 30, Heartbeat = 10, Drain = 5; // a stopping instance deregisters 5 s before it exits
    const int DnsTtl = 30, IgnoredTtl = 300;

    record Instance(string Name, int Start, int End, string Ends); // End -1 = runs to the end
    record Result(int Failed, int SentToDead, string Notice);

    static readonly Instance[] Instances =
    {
        new("p1", 0, -1, "runs"), new("p2", 0, 155, "crash"), new("p3", 0, 383, "crash"), new("p4", 60, 300, "stop"),
        new("p5", 60, 515, "crash"), new("p6", 245, -1, "runs"), new("p7", 420, -1, "runs"), new("p8", 470, -1, "runs"),
    };

    static bool Alive(Instance x, int t) => x.Start <= t && (x.End < 0 || t < x.End);
    static Instance ByName(string name) => Instances.First(x => x.Name == name);

    static Result Run(string mode, bool retry)
    {
        var registry = new Dictionary<string, int>(); // name -> second of the last renewal
        var view = new List<string>(); var pending = new List<string>();
        int counter = 0, failed = 0, sentToDead = 0;
        var lastSeen = new Dictionary<string, int>(); // dead instance -> last second the caller still listed it
        for (int t = 0; t < Horizon; t++)
        {
            foreach (var x in Instances)
            {
                bool draining = x.Ends == "stop" && t >= x.End - Drain;
                if (!Alive(x, t) || draining) continue; // a crashed instance simply goes silent
                if (t == x.Start || (t - x.Start) % Heartbeat == 0) registry[x.Name] = t; // register, then renew the lease
            }
            foreach (var x in Instances) if (x.Ends == "stop" && t == x.End - Drain) registry.Remove(x.Name); // clean deregistration
            foreach (var (name, last) in registry.ToList()) if (t - last >= Ttl) registry.Remove(name); // the lease ran out
            var current = registry.Keys.OrderBy(k => k, StringComparer.Ordinal).ToList();

            if (mode == "static" && t == 0) view = new List<string> { "p1", "p2", "p3" }; // written into a config file once
            if (mode == "dns" && t % DnsTtl == 0) view = current; // the cached answer expires with the record's TTL
            if (mode == "dns-ignoring-ttl" && t % IgnoredTtl == 0) view = current; // the client keeps answers for 5 minutes
            if (mode == "watch") { view = t == 0 ? current : pending; pending = current; } // pushed changes arrive 1 s later

            for (int r = 0; r < Rate; r++)
            {
                int i = counter++ % view.Count;
                if (Alive(ByName(view[i]), t)) continue;
                sentToDead++;
                if (retry && Alive(ByName(view[(i + 1) % view.Count]), t)) continue; // another instance answers
                failed++;
            }
            foreach (var name in view) if (!Alive(ByName(name), t)) lastSeen[name] = t;
        }
        var notice = new List<string>();
        foreach (var x in Instances.Where(x => x.Ends == "crash"))
        {
            if (!lastSeen.TryGetValue(x.Name, out int last)) notice.Add($"{x.Name}:never-listed"); // the caller never knew this instance existed
            else if (last == Horizon - 1) notice.Add($"{x.Name}:never");
            else notice.Add($"{x.Name}:{last - x.End + 1}s");
        }
        return new Result(failed, sentToDead, string.Join(" ", notice));
    }

    static void Check(bool ok, string msg)
    {
        if (!ok) { Console.Error.WriteLine("assertion failed: " + msg); Environment.Exit(1); }
    }

    public static void Main()
    {
        var modes = new[] { ("static", false), ("dns", false), ("dns-ignoring-ttl", false), ("watch", false), ("watch", true) };
        var results = new List<Result>();
        foreach (var (mode, retry) in modes)
        {
            var r = Run(mode, retry);
            results.Add(r);
            string label = mode + (retry ? "+retry" : "");
            Console.WriteLine($"{label,-17} failed={r.Failed} sent_to_dead={r.SentToDead} crash_noticed_after={r.Notice}");
        }
        var (stat, dns, ignoring, watch, watchRetry) = (results[0], results[1], results[2], results[3], results[4]);
        Check(watch.Failed < dns.Failed && dns.Failed < ignoring.Failed && ignoring.Failed < stat.Failed, "fresher lists fail less");
        Check(watchRetry.Failed == 0 && watchRetry.SentToDead == watch.SentToDead, "a retry hides the stale entry but does not remove it");
        Console.WriteLine("failed requests out of " + Horizon * Rate + " sent");
    }
}
