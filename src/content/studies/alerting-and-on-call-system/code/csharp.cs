// An alerting pipeline in C#:
// a rule fires only after its condition held for a while, then alerts are silenced, deduplicated, grouped into notifications and escalated.
using System;
using System.Collections.Generic;
using System.Linq;

public record Alert(int Id, int Minute, string Service, string Name, int Instance);
public record Silence(string Service, int From, int To);

public static class Program
{
    const int Seed = 7, Minutes = 120, Threshold = 60, QuickFor = 1, PatientFor = 3;
    const int RawAlerts = 400, Instances = 8;
    static long seed = Seed;
    // Linear congruential generator (Numerical Recipes constants), high 16 bits.
    static int Random(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)((seed / 65536) % n); }

    // 1. Rule evaluation: fire when the value has been above the threshold for forMinutes samples in a row.
    static int Evaluate(int[] samples, int threshold, int forMinutes)
    {
        int fires = 0, run = 0;
        for (int minute = 0; minute < samples.Length; minute++)
        {
            run = samples[minute] > threshold ? run + 1 : 0;
            if (run == forMinutes) fires++; // the moment it turns from pending into firing
        }
        return fires;
    }

    public static int Main()
    {
        var samples = Enumerable.Range(0, Minutes).Select(_ => Random(100)).ToArray();
        int quick = Evaluate(samples, Threshold, QuickFor), patient = Evaluate(samples, Threshold, PatientFor);
        Console.WriteLine($"rule value > 60 over 120 minutes: {quick} fires with for=1, {patient} fires with for=3");

        // 2. Firing alerts from three services, with many repeats of the same alert.
        string[] services = { "checkout", "search", "batch" }, names = { "latency", "errors" };
        var raw = new List<Alert>();
        for (int i = 0; i < RawAlerts; i++)
        {
            int minute = Random(Minutes);
            string service = services[Random(services.Length)];
            string name = names[Random(names.Length)];
            raw.Add(new Alert(i, minute, service, name, Random(Instances)));
        }
        raw.Sort((a, b) => a.Minute != b.Minute ? a.Minute.CompareTo(b.Minute) : a.Id.CompareTo(b.Id));

        var silences = new[] { new Silence("batch", 30, 90) }; // a maintenance window for the batch service
        const int DedupeMinutes = 10, GroupMinutes = 10;
        var lastSeen = new Dictionary<string, int>();
        var notifications = new Dictionary<string, int>();
        int silenced = 0, duplicates = 0, fresh = 0;
        foreach (var a in raw)
        {
            if (silences.Any(s => s.Service == a.Service && a.Minute >= s.From && a.Minute < s.To)) { silenced++; continue; }
            string fingerprint = $"{a.Name}/{a.Service}/{a.Instance}";
            bool seen = lastSeen.TryGetValue(fingerprint, out int previous);
            lastSeen[fingerprint] = a.Minute;
            if (seen && a.Minute - previous < DedupeMinutes) { duplicates++; continue; } // the same alert, still firing
            fresh++;
            string group = $"{a.Service}/{a.Name}@{a.Minute / GroupMinutes}"; // one notification per service, alert name and time slot
            notifications[group] = notifications.GetValueOrDefault(group) + 1;
        }
        Console.WriteLine($"{raw.Count} raw alerts: {silenced} silenced, {duplicates} duplicates, {fresh} new");
        Console.WriteLine($"{fresh} new alerts became {notifications.Count} notifications");

        // 3. Escalation: page the primary, and if nobody acknowledges, the secondary, and then the manager.
        int[] ackChance = { 60, 70, 100 }, pages = { 0, 0, 0 };
        for (int n = 0; n < notifications.Count; n++)
        {
            for (int level = 0; level < ackChance.Length; level++)
            {
                pages[level]++;
                if (Random(100) < ackChance[level]) break;
            }
        }
        int totalPages = pages.Sum();
        Console.WriteLine($"pages: primary {pages[0]}, secondary {pages[1]}, manager {pages[2]}");
        Console.WriteLine($"{raw.Count} raw alerts became {totalPages} pages, a reduction of {100 * (raw.Count - totalPages) / raw.Count}%");

        bool ok = raw.Count == silenced + duplicates + fresh && notifications.Values.Sum() == fresh && notifications.Count <= fresh
            && pages[0] == notifications.Count && pages[0] >= pages[1] && pages[1] >= pages[2] && patient <= quick;
        return ok ? 0 : 1;
    }
}
