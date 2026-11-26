// An image pipeline under a bulk import, second by second for 20 minutes. Sellers upload 10 photos a second; each
// photo takes a worker 2 seconds (6 variants). At 60 s a big seller imports 100,000 photos at once. Some images are
// broken and make a worker spend 30 seconds before it gives up. Everything is integers, so the output never changes.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const int End = 1200;        // seconds simulated
    const int LivePerS = 10;     // photos a second from sellers editing their listings
    const int Cost = 2;          // worker-seconds per photo
    const int PoisonCost = 30;   // worker-seconds a broken image burns before the job times out
    const int BulkAt = 60;       // the bulk import arrives at this second
    const int PoisonAt = 120;    // broken images arrive at this second, among the live uploads
    const int MaxTries = 3;      // with backoff, a job that failed this often goes to the dead-letter queue
    const int Backoff = 10;      // first retry waits this long, then doubles
    const int MinW = 30, MaxW = 400, Boot = 60, ScaleEvery = 30, Drain = 120; // autoscaler

    class Batch { public int T; public string Kind = ""; public int N; public int Tries; public Batch With(int n) => new() { T = T, Kind = Kind, N = n, Tries = Tries }; }
    static int CostOf(Batch b) => b.Kind == "poison" ? PoisonCost : Cost;

    static void Run(string name, bool lanes, int workers, int bulk, int poison, bool backoff, bool autoscale)
    {
        var live = new List<Batch>(); var batch = new List<Batch>();
        var waiting = new List<(int Ready, Batch B)>(); var pending = new List<(int At, int Count)>();
        var lat = new Dictionary<int, int>(); // seconds from upload to done -> photos
        int w = workers, budget = 0, bulkDone = 0, bulkEnd = -1, burned = 0, dlq = 0; long workerSeconds = 0;
        List<Batch> LaneOf(string kind) => lanes && kind == "bulk" ? batch : live;

        for (int t = 0; t < End; t++)
        {
            live.Add(new Batch { T = t, Kind = "live", N = LivePerS });
            if (t == BulkAt && bulk > 0) LaneOf("bulk").Add(new Batch { T = t, Kind = "bulk", N = bulk });
            if (t == PoisonAt) for (int i = 0; i < poison; i++) live.Add(new Batch { T = t, Kind = "poison", N = 1 });
            for (int i = waiting.Count - 1; i >= 0; i--) if (waiting[i].Ready <= t) { live.Add(waiting[i].B); waiting.RemoveAt(i); }
            for (int i = pending.Count - 1; i >= 0; i--) if (pending[i].At <= t) { w += pending[i].Count; pending.RemoveAt(i); }
            if (autoscale && t % ScaleEvery == 0)
            {
                int backlog = live.Concat(batch).Sum(b => b.N * CostOf(b));
                int target = Math.Min(MaxW, MinW + (backlog + Drain - 1) / Drain);
                int planned = w + pending.Sum(p => p.Count);
                if (target > planned) pending.Add((t + Boot, target - planned));
                else if (target < w && pending.Count == 0) w = target;
            }
            workerSeconds += w;
            budget += w;
            foreach (var q in new[] { live, batch })
            {
                while (q.Count > 0 && budget >= CostOf(q[0]))
                {
                    var b = q[0]; int c = CostOf(b); int k = Math.Min(b.N, budget / c);
                    budget -= k * c; b.N -= k;
                    if (b.Kind == "live") { int d = t - b.T + Cost; lat[d] = lat.GetValueOrDefault(d) + k; } // waited, then 2 s of work
                    if (b.Kind == "bulk") { bulkDone += k; if (bulkDone == bulk) bulkEnd = t; }
                    if (b.Kind == "poison")
                    {
                        burned += c;
                        b.Tries++;
                        if (!backoff) waiting.Add((t + PoisonCost, b.With(1))); // back on the queue the moment the worker gives up, for ever
                        else if (b.Tries >= MaxTries) dlq++;            // give up: a person looks at it
                        else waiting.Add((t + PoisonCost + Backoff * (1 << (b.Tries - 1)), b.With(1))); // after the failed run, then the delay
                    }
                    if (b.N == 0) q.RemoveAt(0);
                }
            }
            if (live.Count == 0 && batch.Count == 0) budget = 0; // idle time cannot be saved up
        }

        int total = LivePerS * End, seen = 0, p95 = -1, fast = 0;
        foreach (int s in lat.Keys.OrderBy(x => x))
        {
            seen += lat[s];
            if (s <= 10) fast = seen;
            if (p95 < 0 && seen * 100 >= total * 95) p95 = s;
        }
        Console.WriteLine($"-- {name}");
        Console.WriteLine($"  live photos: p95 {(p95 < 0 ? "over 20 min" : $"{p95}s")}, {fast * 100 / total}% within 10s");
        string bulkText = bulk == 0 ? "none" : bulkEnd < 0 ? $"{bulkDone} of {bulk} done" : $"done at {bulkEnd}s";
        Console.WriteLine($"  bulk import: {bulkText}; broken images burned {burned} worker-seconds, {dlq} in the dead-letter queue");
        Console.WriteLine($"  {w} workers at the end, {workerSeconds / 3600} worker-hours used");
        if (bulkDone > bulk || fast > total) throw new Exception("impossible count");
    }

    public static void Main()
    {
        Run("one queue, 30 workers", false, 30, 100000, 0, false, false);
        Run("separate lanes", true, 30, 100000, 0, false, false);
        Run("separate lanes, autoscaled", true, 30, 100000, 0, false, true);
        Run("separate lanes, 20 broken images retried at once", true, 30, 100000, 20, false, false);
        Run("separate lanes, 20 broken images, backoff and a dead-letter queue", true, 30, 100000, 20, true, false);
        Run("separate lanes, autoscaled, 20 broken images retried at once", true, 30, 100000, 20, false, true);
    }
}
