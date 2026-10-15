// A preview-environment controller, in C#:
// one namespace per pull request, routing by subdomain, idle sleep, a time limit, a cap on running environments, and cleanup on merge.
using System;
using System.Collections.Generic;
using System.Linq;

public class Env
{
    public int Pr; public string Ns = ""; public string State = "running"; public int Created; public int LastHit;
}

public class Platform
{
    public const int Idle = 30, Ttl = 200, MaxRunning = 4; // ticks of silence before sleep, ticks of life, environments allowed to run at once
    public List<Env> Envs = new(); // one entry per open pull request, in creation order
    public List<string> Log = new();
    public int Opened, Served, NotFound, ColdStarts, Slept, Evicted, Merged, Expired, Peak;

    public Env? Find(int pr) => Envs.FirstOrDefault(e => e.Pr == pr);
    public List<Env> Running() => Envs.Where(e => e.State == "running").ToList();
    void Note(int now, string text) => Log.Add($"t={now} {text}");

    // Routing: "pr-104.preview.example.com" belongs to namespace "pr-104". Anything else is not ours.
    public int Route(string host)
    {
        var parts = host.Split('.');
        return parts.Length == 4 && parts[0].StartsWith("pr-") && string.Join(".", parts.Skip(1)) == "preview.example.com" ? int.Parse(parts[0].Substring(3)) : -1;
    }

    void MakeRoom(int now) // the quota: at most MaxRunning environments run, so the least recently used one goes to sleep
    {
        while (Running().Count >= MaxRunning)
        {
            var lru = Running().Aggregate((a, b) => b.LastHit < a.LastHit ? b : a);
            lru.State = "sleeping"; Evicted++; Note(now, $"{lru.Ns} put to sleep to make room");
        }
    }
    public void Open(int pr, int now)
    {
        if (Find(pr) != null) return;
        MakeRoom(now);
        Envs.Add(new Env { Pr = pr, Ns = $"pr-{pr}", Created = now, LastHit = now });
        Opened++; Note(now, $"pr-{pr} created");
    }
    public void Hit(string host, int now)
    {
        var env = Find(Route(host));
        if (env == null) { NotFound++; return; }
        if (env.State == "sleeping") { MakeRoom(now); env.State = "running"; ColdStarts++; Note(now, $"{env.Ns} woken by a request"); }
        env.LastHit = now; Served++;
    }
    public void Merge(int pr, int now)
    {
        if (Find(pr) == null) return;
        Envs = Envs.Where(e => e.Pr != pr).ToList(); Merged++; Note(now, $"pr-{pr} merged and deleted");
    }
    public void Tick(int now) // the reaper: idle environments sleep, old ones are deleted
    {
        foreach (var e in Envs) if (e.State == "running" && now - e.LastHit >= Idle) { e.State = "sleeping"; Slept++; Note(now, $"{e.Ns} idle, asleep"); }
        foreach (var e in Envs) if (now - e.Created >= Ttl) { Expired++; Note(now, $"{e.Ns} reached its time limit, deleted"); }
        Envs = Envs.Where(e => now - e.Created < Ttl).ToList();
        Peak = Math.Max(Peak, Running().Count);
    }
}

public static class Program
{
    static long seed = 7;
    static int Random(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)((seed / 65536) % n); }

    public static int Main()
    {
        var p = new Platform();
        for (int t = 0; t < 400; t++)
        {
            int r = Random(100), pr = 100 + Random(10);
            if (r < 6) p.Open(pr, t);
            else if (r < 40) p.Hit($"pr-{pr}.preview.example.com", t);
            else if (r < 43) p.Merge(pr, t);
            else if (r < 45) p.Hit("www.example.com", t);
            p.Tick(t);
            if (p.Running().Count > Platform.MaxRunning) { Console.WriteLine("quota broken"); return 1; }
        }
        foreach (var l in p.Log.Take(10)) Console.WriteLine(l);
        Console.WriteLine($"opened {p.Opened}, merged {p.Merged}, expired {p.Expired}, slept {p.Slept}, evicted {p.Evicted}, cold starts {p.ColdStarts}");
        Console.WriteLine($"served {p.Served}, not found {p.NotFound}, peak running {p.Peak}, still open {p.Envs.Count}");
        bool unique = p.Envs.Select(e => e.Ns).Distinct().Count() == p.Envs.Count;
        bool within = p.Envs.All(e => 399 - e.Created < Platform.Ttl);
        Console.WriteLine($"namespaces unique: {unique.ToString().ToLower()}; all within time limit: {within.ToString().ToLower()}");
        return !unique || p.Peak > Platform.MaxRunning || p.Opened != p.Merged + p.Expired + p.Envs.Count ? 1 : 0;
    }
}
