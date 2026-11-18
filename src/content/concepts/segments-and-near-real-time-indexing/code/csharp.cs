// Near-real-time indexing: documents wait in a memory buffer, a refresh turns the buffer into a new immutable segment
// that searches can see, and a merge policy combines similar-sized segments into bigger ones. Two minutes, in 100 ms ticks.
// Everything is integers and fixed events, so the output never changes.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const int TickMs = 100;
    const int EndMs = 120000;    // 2 minutes simulated
    const int UpdateEvery = 10;  // every 10th new document replaces an older one: the old copy is only marked deleted

    class Segment { public int Level, Docs, Dead; }
    record Result(long Arrived, int Created, int Merges, int Peak, int Final, long DelayAvg, int DelayMax, long AmpX100, long Written, long Dead);

    // docsPerSec: arrivals (a multiple of 10); refreshMs: a multiple of 100; mergeAt: segments of one level that trigger a merge (0 = never merge)
    static Result Run(int docsPerSec, int refreshMs, int mergeAt)
    {
        int perTick = docsPerSec * TickMs / 1000;
        var segments = new List<Segment>();
        long buffer = 0, arrived = 0, flushed = 0, mergeWritten = 0, delaySum = 0;
        int merges = 0, created = 0, delayMax = 0, peak = 0;
        var pending = new List<int>(); // arrival time (middle of the tick) of each tick's batch that is not yet searchable

        for (int t = TickMs; t <= EndMs; t += TickMs)
        {
            buffer += perTick;
            pending.Add(t - TickMs / 2);
            for (int i = 0; i < perTick; i++)
            {
                arrived++;
                if (arrived % UpdateEvery == 0)
                {
                    var old = segments.FirstOrDefault(s => s.Docs - s.Dead > 0);
                    if (old != null) old.Dead++; // a delete is a mark, the document stays on disk until a merge rewrites the segment
                }
            }
            if (t % refreshMs == 0 && buffer > 0)
            {
                segments.Add(new Segment { Level = 0, Docs = (int)buffer });
                created++; flushed += buffer; buffer = 0;
                foreach (var at in pending) { int d = t - at; delaySum += (long)d * perTick; if (d > delayMax) delayMax = d; }
                pending.Clear();
                while (mergeAt > 0)
                {
                    int level = -1;
                    for (int l = 0; l < 20 && level < 0; l++) if (segments.Count(s => s.Level == l) >= mergeAt) level = l;
                    if (level < 0) break;
                    var group = segments.Where(s => s.Level == level).Take(mergeAt).ToList();
                    int live = group.Sum(s => s.Docs - s.Dead);
                    foreach (var s in group) segments.Remove(s);
                    segments.Add(new Segment { Level = level + 1, Docs = live });
                    mergeWritten += live; merges++;
                }
            }
            peak = Math.Max(peak, segments.Count);
        }
        long dead = segments.Sum(s => (long)s.Dead);
        return new Result(arrived, created, merges, peak, segments.Count, delaySum / flushed, delayMax,
            (flushed + mergeWritten) * 100 / flushed, flushed + mergeWritten, dead);
    }

    static void Show(string name, Result r)
    {
        Console.WriteLine($"-- {name}");
        Console.WriteLine($"  searchable after {r.DelayAvg} ms on average, {r.DelayMax} ms at worst");
        Console.WriteLine($"  segments: {r.Created} created, {r.Merges} merges, peak {r.Peak}, {r.Final} at the end (a query visits every one)");
        Console.WriteLine($"  disk writes: {r.Written} documents for {r.Arrived} arrived (write amplification x100 = {r.AmpX100}); {r.Dead} deleted copies still on disk");
    }

    public static void Main()
    {
        var cases = new (string, Result)[]
        {
            ("500 docs/s, refresh 1 s, merge at 10 similar segments", Run(500, 1000, 10)),
            ("500 docs/s, refresh 100 ms, never merge", Run(500, 100, 0)),
            ("500 docs/s, refresh 100 ms, merge at 10 similar segments", Run(500, 100, 10)),
            ("500 docs/s, refresh 30 s, merge at 10 similar segments", Run(500, 30000, 10)),
            ("500 docs/s, refresh 1 s, merge at 4 similar segments", Run(500, 1000, 4)),
        };
        foreach (var (name, r) in cases) Show(name, r);
        if (cases[1].Item2.Peak <= cases[2].Item2.Peak * 10 || cases[3].Item2.DelayAvg <= cases[0].Item2.DelayAvg) throw new Exception("impossible result");
    }
}
