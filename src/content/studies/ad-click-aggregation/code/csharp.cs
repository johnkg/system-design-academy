// Ad click counting by event time, in C#:
// tumbling windows are closed by a watermark (the newest event time seen, minus the allowed lateness),
// events for a closed window are dropped as late, and a set of click ids removes duplicates.
using System;
using System.Collections.Generic;
using System.Linq;

public record Click(int Id, int T, int Arrival, int Copy);
public record Result(int Total, int Late, int Duplicates, int Lost, int AvgDelay);

public static class Program
{
    const int Seed = 7, Clicks = 400, SpanS = 300;
    const int OnTimePct = 85, HeldPct = 12; // the remaining 3% come from phones that were offline
    const int OnTimeSpread = 3, HeldMin = 2, HeldSpread = 9, OfflineMin = 10, OfflineSpread = 36; // delays 0..2, 2..10, 10..45 s
    const int RetryOneIn = 8;
    const int SoonIn5 = 4, SoonMin = 1, SoonSpread = 7, LateCopyMin = 15, LateCopySpread = 41; // copy delay: 4 in 5 after 1..7 s, else 15..55 s
    const int WindowS = 30, ExactLateness = 60; // ExactLateness exceeds every delay in the stream

    static ulong seed = Seed;
    static int Random(int n) { seed = (seed * 1664525UL + 1013904223UL) % 4294967296UL; return (int)((seed / 65536) % (ulong)n); }

    // 400 true clicks over 300 seconds. Most arrive within 2 s, some are held up for up to 45 s (a phone that was offline).
    // About 1 click in 8 is sent twice (a retry), and the copy arrives a few seconds, sometimes up to a minute, later.
    static List<Click> MakeStream()
    {
        var events = new List<Click>();
        for (int id = 0; id < Clicks; id++)
        {
            int t = Random(SpanS), u = Random(100);
            int delay = u < OnTimePct ? Random(OnTimeSpread) : u < OnTimePct + HeldPct ? HeldMin + Random(HeldSpread) : OfflineMin + Random(OfflineSpread);
            events.Add(new Click(id, t, t + delay, 0));
            if (Random(RetryOneIn) == 0) events.Add(new Click(id, t, t + delay + (Random(5) < SoonIn5 ? SoonMin + Random(SoonSpread) : LateCopyMin + Random(LateCopySpread)), 1));
        }
        return events.OrderBy(e => e.Arrival).ThenBy(e => e.Id).ThenBy(e => e.Copy).ToList();
    }

    static Result Aggregate(List<Click> events, int windowSize, int lateness, bool dedup)
    {
        var seen = new HashSet<int>(); var counts = new Dictionary<int, int>(); var counted = new HashSet<int>();
        int maxTime = -1, closedUpTo = -1, late = 0, duplicates = 0, delaySum = 0, closedCount = 0;
        foreach (var e in events)
        {
            int w = e.T / windowSize;
            if (w <= closedUpTo) { late++; continue; }                  // its window is already final
            if (dedup && seen.Contains(e.Id)) continue;                 // the same click again
            seen.Add(e.Id);
            if (counted.Contains(e.Id)) duplicates++;                   // a click counted twice
            counted.Add(e.Id);
            counts[w] = counts.GetValueOrDefault(w) + 1;
            if (e.T > maxTime)                                          // the watermark can only move forward
            {
                maxTime = e.T;
                while ((closedUpTo + 2) * windowSize <= maxTime - lateness) // the next window ends before the watermark
                {
                    closedUpTo++; delaySum += e.Arrival - (closedUpTo + 1) * windowSize; closedCount++;
                }
            }
        }
        return new Result(counts.Values.Sum(), late, duplicates, Clicks - counted.Count, delaySum / closedCount);
    }

    public static int Main()
    {
        var events = MakeStream();
        Console.WriteLine($"stream: {events.Count} events = 400 clicks + {events.Count(e => e.Copy == 1)} retried copies");
        var rows = new List<(bool Dedup, Result R)>();
        foreach (var (windowSize, lateness, dedup) in new[] { (30, 0, false), (30, 5, false), (30, 5, true), (30, 30, true), (30, 60, true), (10, 5, true), (60, 5, true) })
        {
            var r = Aggregate(events, windowSize, lateness, dedup);
            rows.Add((dedup, r));
            Console.WriteLine($"window {windowSize}s lateness {lateness}s dedup {(dedup ? "on " : "off")}: counted {r.Total}, lost {r.Lost}, double counted {r.Duplicates}, late events dropped {r.Late}, window final after {r.AvgDelay}s");
        }

        bool ok = true;
        foreach (var (dedup, r) in rows)
        {
            if (dedup && r.Duplicates != 0) ok = false;                 // dedup never counts a click twice
            if (!dedup && r.Total - Clicks + r.Lost != r.Duplicates) ok = false; // counted = clicks seen + double counts
        }
        var full = Aggregate(events, WindowS, ExactLateness, true);                     // more lateness than any delay, with dedup: exact
        if (full.Total != Clicks || full.Lost != 0 || full.Late != 0) ok = false;
        var a = Aggregate(events, WindowS, 0, true); var b = Aggregate(events, WindowS, 5, true); var c = Aggregate(events, WindowS, 30, true);
        if (!(a.Late >= b.Late && b.Late >= c.Late && c.Late >= full.Late)) ok = false; // more lateness never drops more
        Console.WriteLine($"invariants hold: {(ok ? "true" : "false")}");
        return ok ? 0 : 1;
    }
}
