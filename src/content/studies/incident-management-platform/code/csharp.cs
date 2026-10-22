// An incident core in C#: alerts are grouped into incidents, the on-call chain is paged until someone
// acknowledges, every step lands in an append-only timeline, and status updates fan out with retries and dedupe.
using System;
using System.Collections.Generic;
using System.Linq;

public class Incident
{
    public int Id, Start, Last, Alerts, Sev, Paged, Acked;
    public string Service = "", Commander = "";
}

public record Entry(int T, int Idx, string Text);

public static class Program
{
    const long Seed = 4242;
    const int Alerts = 24, AlertSpacing = 4; // one alert about every 4 minutes
    const int Severities = 3, PublicSev = 2; // sev 1..3; sev 1 and 2 get a status page update
    const int MaxAckDelay = 9; // a paged person answers after 1..9 minutes
    const int SendFailPct = 15, AckLostPct = 5;
    static long seed = Seed;
    static int Rand(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296L; return (int)((seed / 65536) % n); }

    static readonly string[] Services = { "checkout", "search", "login" };
    static readonly string[] Chain = { "primary", "secondary", "manager" };
    const int AckWindow = 5;   // minutes to acknowledge before the next level is paged
    const int GroupGap = 10;   // an alert within 10 minutes of the last one joins the open incident
    const int Subscribers = 300, Attempts = 4;

    static readonly List<Entry> timeline = new(); // append-only: entries are never edited or removed
    static void Log(int t, string text) => timeline.Add(new Entry(t, timeline.Count, text));

    public static int Main()
    {
        // 1. Group alerts into incidents. Severity 1 is the worst, and an incident takes the worst severity of its alerts.
        var incidents = new List<Incident>();
        for (int i = 0; i < Alerts; i++)
        {
            int t = i * AlertSpacing + Rand(AlertSpacing); string service = Services[Rand(Services.Length)]; int sev = 1 + Rand(Severities);
            var open = incidents.FirstOrDefault(x => x.Service == service && t - x.Last <= GroupGap);
            if (open != null) { open.Last = t; open.Alerts++; open.Sev = Math.Min(open.Sev, sev); }
            else incidents.Add(new Incident { Id = incidents.Count + 1, Service = service, Start = t, Last = t, Alerts = 1, Sev = sev });
        }

        // 2. Page the chain: each level has AckWindow minutes, and the first person to acknowledge becomes commander.
        foreach (var inc in incidents)
        {
            int now = inc.Start, paged = 0;
            Log(now, $"INC-{inc.Id} declared on {inc.Service}, sev {inc.Sev}, from {inc.Alerts} alerts");
            foreach (var level in Chain)
            {
                int delay = 1 + Rand(MaxAckDelay);
                paged++;
                Log(now, $"INC-{inc.Id} paged {level}");
                if (delay <= AckWindow) { now += delay; inc.Commander = level; Log(now, $"INC-{inc.Id} {level} acknowledged and is commander"); break; }
                now += AckWindow;
            }
            inc.Paged = paged;
            inc.Acked = now;
            if (inc.Commander == "") Log(now, $"INC-{inc.Id} nobody acknowledged: page the whole team");
        }

        // 3. Status page fan-out for serious incidents. A key per (incident, subscriber) lets the receiver drop repeats.
        var received = new HashSet<string>();
        int attempts = 0, duplicates = 0, gaveUp = 0, total = 0;
        foreach (var inc in incidents.Where(x => x.Sev <= PublicSev))
        {
            for (int s = 0; s < Subscribers; s++)
            {
                string key = $"{inc.Id}:{s}";
                total++;
                bool done = false;
                for (int a = 0; a < Attempts && !done; a++)
                {
                    attempts++;
                    if (Rand(100) < SendFailPct) continue;                                 // the send failed: retry
                    if (received.Contains(key)) duplicates++; else received.Add(key); // delivered, and a repeat is ignored
                    done = Rand(100) >= AckLostPct;                                        // 5%: the acknowledgement was lost, so we resend
                }
                if (!done && !received.Contains(key)) gaveUp++;
            }
            Log(inc.Acked, $"INC-{inc.Id} status page update sent to {Subscribers} subscribers");
        }

        var ordered = timeline.OrderBy(e => e.T).ThenBy(e => e.Idx).ToList();
        Console.WriteLine($"alerts 24 -> incidents {incidents.Count}");
        foreach (var inc in incidents)
            Console.WriteLine($"INC-{inc.Id} {inc.Service} sev {inc.Sev} alerts {inc.Alerts} paged {inc.Paged} commander {(inc.Commander == "" ? "none" : inc.Commander)} acked at {inc.Acked}");
        Console.WriteLine($"timeline entries {ordered.Count}, first: {ordered[0].Text}");
        Console.WriteLine($"fan-out: {total} messages, {attempts} attempts, {duplicates} duplicates dropped, {gaveUp} gave up, {received.Count} delivered");

        bool times = ordered.Select((e, i) => i == 0 || ordered[i - 1].T <= e.T).All(b => b);
        bool kept = incidents.Sum(x => x.Alerts) == Alerts;
        bool accounted = received.Count + gaveUp == total;
        Console.WriteLine($"checks: ordered {times.ToString().ToLower()}, alerts kept {kept.ToString().ToLower()}, delivered + gave up = total {accounted.ToString().ToLower()}");
        return times && kept && accounted ? 0 : 1;
    }
}
