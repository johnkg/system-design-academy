// Fan-out tail latency with and without hedged requests: a deterministic Monte Carlo with integer milliseconds.
// Backend model: 99% of calls take 6..14 ms (mean 10), 1% take 200..1000 ms. Load makes everything slower (M/M/1-style).
using System;
using System.Collections.Generic;
using System.Linq;

class Sim
{
    const int TailBp = 100; // 1% in basis points

    class Lcg
    {
        uint s;
        public Lcg(uint seed) { s = seed; }
        public long Next() { s = unchecked(s * 1664525u + 1013904223u); return s >> 8; }
    }
    class State { public long Tokens; public bool Budget; }
    record Result(long P50, long P95, long P99, long Delay, long S, long HitSlowPct, long ExtraPm);

    static long TailBpOf(long s) => Math.Min(5000, TailBp * s / 1000); // s = slowdown in milli (1000 = nominal)
    static bool IsTail(long r1, long s) => r1 % 10000 < TailBpOf(s);
    static long Latency(long r1, long r2, long r3, long s) =>
        IsTail(r1, s) ? 200 + r2 % 801 : Math.Max(1, (6 + r2 % 5 + r3 % 5) * s / 1000);

    // Exact percentile of ONE backend's latency (weighted points, no sampling noise): this is where the hedge delay comes from.
    static long DelayFor(long pct, long s)
    {
        long tb = TailBpOf(s);
        var pts = new List<(long v, long w)>();
        for (int a = 0; a < 5; a++) for (int b = 0; b < 5; b++) pts.Add(((6 + a + b) * s / 1000, (10000 - tb) * 801));
        for (int k = 0; k < 801; k++) pts.Add((200 + k, tb * 25));
        pts = pts.OrderBy(p => p.v).ToList();
        long total = 25L * 801 * 10000, cum = 0;
        foreach (var (v, w) in pts) { cum += w; if (cum * 100 >= pct * total) return Math.Max(1, v); }
        return pts[^1].v;
    }

    // One shard call with R replicas. Copy k+1 is sent at k*delay if nothing has answered yet. Returns (latency, hedgesSent, primaryWasSlow).
    static (long, int, bool) ShardCall(Lcg next, State st, long delay, int R, long s)
    {
        var t = new long[3]; bool tail1 = false;
        for (int k = 0; k < 3; k++)
        {
            long r1 = next.Next(), r2 = next.Next(), r3 = next.Next();
            if (k == 0) tail1 = IsTail(r1, s);
            t[k] = Latency(r1, r2, r3, s);
        }
        long done = t[0]; int hedges = 0;
        st.Tokens = Math.Min(10000, st.Tokens + 50); // hedge budget: 5% of calls may hedge (shed the rest)
        for (int k = 1; k < R && delay > 0 && done > k * delay; k++)
        {
            if (st.Budget && st.Tokens < 1000) break; // load shedding: no budget, no hedge
            if (st.Budget) st.Tokens -= 1000;
            hedges++; done = Math.Min(done, k * delay + t[k]);
        }
        return (done, hedges, tail1);
    }

    // Load feedback: hedges add traffic, utilisation rises, every backend slows down, more calls pass the delay.
    static (long s, long delay, long extra) Solve(long delayPct, bool adaptive, int R, long rho, bool budget)
    {
        long s = 1000, extra = 0;
        if (delayPct == 0) return (s, 0, extra);
        long d0 = DelayFor(delayPct, 1000);
        for (int it = 0; it < 8; it++)
        {
            long d = adaptive ? DelayFor(delayPct, s) : d0;
            var next = new Lcg(777); var st = new State { Budget = budget }; long h = 0;
            for (int i = 0; i < 20000; i++) h += ShardCall(next, st, d, R, s).Item2;
            extra = h * 1000 / 20000; // extra requests per 1000 primary calls
            long effPm = Math.Min(980, rho * (1000 + extra) / 100);
            s = (1000 - rho * 10) * 1000 / (1000 - effPm);
        }
        return (s, adaptive ? DelayFor(delayPct, s) : d0, extra);
    }

    static Result Run(int fanout, long delayPct, int R, long rho, bool adaptive = false, bool budget = false, int n = 2000)
    {
        var (s, delay, _) = Solve(delayPct, adaptive, R, rho, budget);
        var next = new Lcg(12345); var st = new State { Budget = budget };
        var lat = new List<long>(); long hedges = 0, hitSlow = 0;
        for (int i = 0; i < n; i++)
        {
            long worst = 0; bool slow = false;
            for (int j = 0; j < fanout; j++) { var (l, h, t) = ShardCall(next, st, delay, R, s); worst = Math.Max(worst, l); hedges += h; slow |= t; }
            lat.Add(worst); if (slow) hitSlow++;
        }
        lat.Sort();
        long Pct(long p) => lat[(int)((p * n + 99) / 100 - 1)];
        return new Result(Pct(50), Pct(95), Pct(99), delay, s, hitSlow * 100 / n, hedges * 1000 / ((long)n * fanout));
    }

    static void Show(string label, Result r) =>
        Console.WriteLine($"{label.PadRight(26)} p50={r.P50.ToString().PadLeft(3)} p95={r.P95.ToString().PadLeft(4)} p99={r.P99.ToString().PadLeft(4)} hit-slow={r.HitSlowPct.ToString().PadLeft(2)}% hedge-delay={r.Delay.ToString().PadLeft(3)}ms extra-load={r.ExtraPm / 10}.{r.ExtraPm % 10}%");

    static void Check(bool ok, string msg) { if (!ok) { Console.Error.WriteLine(msg); Environment.Exit(1); } }

    static void Main()
    {
        Console.WriteLine("1 - 0.99^N: " + string.Join(", ", new[] { 1, 10, 50, 100 }.Select(f => $"N={f} {(int)Math.Floor(100 * (1 - Math.Pow(0.99, f)))}%")));
        var off = Run(50, 0, 2, 50); var p95 = Run(50, 95, 2, 50); var p50 = Run(50, 50, 2, 50); var p95b = Run(50, 95, 2, 50, budget: true);
        Console.WriteLine("fan-out 50 shards, 50% load, 2 replicas");
        Show("no hedging", off); Show("hedge after p95", p95); Show("hedge after p95 + budget", p95b); Show("hedge after p50", p50);
        var lone = Run(1, 0, 2, 50); var loneH = Run(1, 95, 2, 50);
        Console.WriteLine("fan-out 1"); Show("no hedging", lone); Show("hedge after p95", loneH);
        Console.WriteLine($"p95 delay {DelayFor(95, 1000)} ms, p50 delay {DelayFor(50, 1000)} ms");

        Check(p95.P99 < off.P99, "hedging at p95 must reduce p99");
        Check(p95.ExtraPm < 100, "hedging at p95 must add under 10% load");
        Check(p50.ExtraPm > 3 * p95.ExtraPm, "hedging at p50 must cost far more than at p95");
        Check(p95b.ExtraPm <= 50, "the budget must cap the extra load at 5%");
        Console.WriteLine("invariants hold");
    }
}
