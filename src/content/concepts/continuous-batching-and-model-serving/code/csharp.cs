// Static vs continuous batching over the same seeded request stream (one GPU replica, one decode step at a time).
// Step cost = 20 ms (weights read once) + 1 ms per sequence in the batch; prefill = 1 ms per 10 prompt tokens.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const int Base = 20, Per = 1, MaxBatch = 8;
    const int TokensPerPrefillMs = 10, MsPerSecond = 1000;
    const int GapSteps = 1000; // resolution of the uniform arrival gap in [0, 2 * meanGap)
    // 80% short answers (16..63 tokens), the rest long (200..399); prompts are 64..963 tokens.
    const int ShortPercent = 80, ShortMin = 16, ShortSpread = 48, LongMin = 200, LongSpread = 200;
    const int PromptMin = 64, PromptSpread = 900;
    const int Requests = 24, Seed = 7, MeanGapMs = 100;
    record Req(long At, int Out, int Prompt);
    record Result(long Tokens, long Tps, long P50, long P95, long Idle, long Steps, long End);

    static List<Req> MakeRequests(int n, uint seed, int meanGap)
    {
        uint s = seed; long t = 0;
        // Linear congruential generator (Numerical Recipes constants), top 24 bits.
        uint Nxt() { s = unchecked(s * 1664525u + 1013904223u); return s >> 8; }
        var reqs = new List<Req>();
        for (int i = 0; i < n; i++)
        {
            t += (long)(Nxt() % GapSteps) * 2 * meanGap / GapSteps; // arrival time in ms
            int o = Nxt() % 100 < ShortPercent ? ShortMin + (int)(Nxt() % ShortSpread) : LongMin + (int)(Nxt() % LongSpread);
            reqs.Add(new Req(t, o, PromptMin + (int)(Nxt() % PromptSpread)));
        }
        return reqs;
    }

    static Result Simulate(List<Req> reqs, string mode)
    {
        long t = 0, steps = 0, tokens = 0; int nx = 0;
        var finish = Enumerable.Repeat(-1L, reqs.Count).ToArray();
        var queue = new Queue<int>(); var active = new List<int[]>();
        while (true)
        {
            while (nx < reqs.Count && reqs[nx].At <= t) queue.Enqueue(nx++);
            if (active.Count == 0 && queue.Count == 0)
            {
                if (nx >= reqs.Count) break;
                t = reqs[nx].At; // GPU idle until the next arrival
                continue;
            }
            long prefill = 0;
            // continuous: refill free slots every step; static: only when the whole batch is empty
            while ((mode == "continuous" || active.Count == 0) && active.Count < MaxBatch && queue.Count > 0)
            {
                int i = queue.Dequeue();
                prefill += (reqs[i].Prompt + TokensPerPrefillMs - 1) / TokensPerPrefillMs;
                active.Add(new[] { i, reqs[i].Out });
            }
            t += Base + Per * active.Count + prefill; // finished static slots still cost compute (padding)
            steps++;
            foreach (var a in active) if (a[1] > 0) { a[1]--; tokens++; }
            if (mode == "continuous")
            {
                foreach (var a in active) if (a[1] == 0) finish[a[0]] = t; // leaves now, slot reused next step
                active = active.Where(a => a[1] > 0).ToList();
            }
            else if (active.All(a => a[1] == 0))
            {
                foreach (var a in active) finish[a[0]] = t; // whole batch answers when the longest ends
                active.Clear();
            }
        }
        var lat = reqs.Select((r, i) => finish[i] - r.At).OrderBy(x => x).ToList();
        long slots = steps * MaxBatch;
        return new Result(tokens, tokens * MsPerSecond / t, lat[(lat.Count - 1) * 50 / 100], lat[(lat.Count - 1) * 95 / 100],
            100 * (slots - tokens) / slots, steps, t);
    }

    public static void Main()
    {
        var reqs = MakeRequests(Requests, Seed, MeanGapMs);
        long total = reqs.Sum(r => (long)r.Out);
        var res = new Dictionary<string, Result>();
        foreach (var mode in new[] { "static", "continuous" })
        {
            var r = res[mode] = Simulate(reqs, mode);
            if (r.Tokens != total) throw new Exception("every requested token must be generated exactly once");
            Console.WriteLine($"{mode,-10} tokens/s={r.Tps} p50={r.P50}ms p95={r.P95}ms idle_slots={r.Idle}% steps={r.Steps} finished_at={r.End}ms");
        }
        if (!(res["continuous"].Tps > res["static"].Tps && res["continuous"].P95 < res["static"].P95)) throw new Exception("continuous should win");
        Console.WriteLine($"continuous batching: {res["continuous"].Tps * 100 / res["static"].Tps}% of static throughput, " +
            $"p95 {res["continuous"].P95 * 100 / res["static"].P95}% of static");
    }
}
