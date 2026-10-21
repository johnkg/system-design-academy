// Fan-out tail latency with and without hedged requests: a deterministic Monte Carlo with integer milliseconds.
// Backend model: 99% of calls take 6..14 ms (mean 10), 1% take 200..1000 ms. Load makes everything slower (M/M/1-style).
using System;
using System.Collections.Generic;
using System.Linq;

class Sim
{
    const int TailBp = 100; // 1% in basis points
    const int BpScale = 10000; // basis points in 100%
    const int Milli = 1000; // slowdown s and loads are in thousandths (1000 = nominal)
    const int MaxTailBp = 5000; // the slow tail never exceeds half of all calls
    const int FastMinMs = 6; // fast calls: 6 ms plus two draws of 0..4 ms
    const int FastSteps = 5;
    const int TailMinMs = 200; // slow calls: 200..1000 ms
    const int TailSpan = 801;
    const int Copies = 3; // latencies drawn per shard call, one per possible replica
    const int BudgetCap = 10000; // hedge budget in tokens: each call earns 50, a hedge costs 1000, so 5% of calls may hedge
    const int BudgetEarn = 50;
    const int HedgeCost = 1000;
    const int SolveRounds = 8; // fixed-point iterations of the load feedback
    const int SolveCalls = 20000; // shard calls sampled per iteration
    const int SolveSeed = 777;
    const int MaxUtilPm = 980; // utilisation is capped at 98%
    const int RunSeed = 12345;
    const int RunCalls = 2000; // fan-out requests per run
    const int Fanout = 50; // demo: shards per request, load in percent, replicas per shard
    const int LoadPct = 50;
    const int Replicas = 2;
    const int MaxHedgeLoadPm = 100; // hedging at p95 must add under 10% load
    const int P50CostRatio = 3; // hedging at p50 must cost at least this many times more

    class Lcg
    {
        uint s;
        public Lcg(uint seed) { s = seed; }
        public long Next() { s = unchecked(s * 1664525u + 1013904223u); return s >> 8; }
    }
    class State { public long Tokens; public bool Budget; }
    record Result(long P50, long P95, long P99, long Delay, long S, long HitSlowPct, long ExtraPm);

    static long TailBpOf(long s) => Math.Min(MaxTailBp, TailBp * s / Milli); // s = slowdown in milli (1000 = nominal)
    static bool IsTail(long r1, long s) => r1 % BpScale < TailBpOf(s);
    static long Latency(long r1, long r2, long r3, long s) =>
        IsTail(r1, s) ? TailMinMs + r2 % TailSpan : Math.Max(1, (FastMinMs + r2 % FastSteps + r3 % FastSteps) * s / Milli);

    // Exact percentile of ONE backend's latency (weighted points, no sampling noise): this is where the hedge delay comes from.
    static long DelayFor(long pct, long s)
    {
        long tb = TailBpOf(s);
        var pts = new List<(long v, long w)>();
        for (int a = 0; a < FastSteps; a++) for (int b = 0; b < FastSteps; b++) pts.Add(((FastMinMs + a + b) * s / Milli, (BpScale - tb) * TailSpan));
        for (int k = 0; k < TailSpan; k++) pts.Add((TailMinMs + k, tb * FastSteps * FastSteps));
        pts = pts.OrderBy(p => p.v).ToList();
        long total = (long)FastSteps * FastSteps * TailSpan * BpScale, cum = 0;
        foreach (var (v, w) in pts) { cum += w; if (cum * 100 >= pct * total) return Math.Max(1, v); }
        return pts[^1].v;
    }

    // One shard call with R replicas. Copy k+1 is sent at k*delay if nothing has answered yet. Returns (latency, hedgesSent, primaryWasSlow).
    static (long, int, bool) ShardCall(Lcg next, State st, long delay, int R, long s)
    {
        var t = new long[Copies]; bool tail1 = false;
        for (int k = 0; k < Copies; k++)
        {
            long r1 = next.Next(), r2 = next.Next(), r3 = next.Next();
            if (k == 0) tail1 = IsTail(r1, s);
            t[k] = Latency(r1, r2, r3, s);
        }
        long done = t[0]; int hedges = 0;
        st.Tokens = Math.Min(BudgetCap, st.Tokens + BudgetEarn); // hedge budget: 5% of calls may hedge (shed the rest)
        for (int k = 1; k < R && delay > 0 && done > k * delay; k++)
        {
            if (st.Budget && st.Tokens < HedgeCost) break; // load shedding: no budget, no hedge
            if (st.Budget) st.Tokens -= HedgeCost;
            hedges++; done = Math.Min(done, k * delay + t[k]);
        }
        return (done, hedges, tail1);
    }

    // Load feedback: hedges add traffic, utilisation rises, every backend slows down, more calls pass the delay.
    static (long s, long delay, long extra) Solve(long delayPct, bool adaptive, int R, long rho, bool budget)
    {
        long s = Milli, extra = 0;
        if (delayPct == 0) return (s, 0, extra);
        long d0 = DelayFor(delayPct, Milli);
        for (int it = 0; it < SolveRounds; it++)
        {
            long d = adaptive ? DelayFor(delayPct, s) : d0;
            var next = new Lcg(SolveSeed); var st = new State { Budget = budget }; long h = 0;
            for (int i = 0; i < SolveCalls; i++) h += ShardCall(next, st, d, R, s).Item2;
            extra = h * Milli / SolveCalls; // extra requests per 1000 primary calls
            long effPm = Math.Min(MaxUtilPm, rho * (Milli + extra) / 100);
            s = (Milli - rho * (Milli / 100)) * Milli / (Milli - effPm);
        }
        return (s, adaptive ? DelayFor(delayPct, s) : d0, extra);
    }

    static Result Run(int fanout, long delayPct, int R, long rho, bool adaptive = false, bool budget = false, int n = RunCalls)
    {
        var (s, delay, _) = Solve(delayPct, adaptive, R, rho, budget);
        var next = new Lcg(RunSeed); var st = new State { Budget = budget };
        var lat = new List<long>(); long hedges = 0, hitSlow = 0;
        for (int i = 0; i < n; i++)
        {
            long worst = 0; bool slow = false;
            for (int j = 0; j < fanout; j++) { var (l, h, t) = ShardCall(next, st, delay, R, s); worst = Math.Max(worst, l); hedges += h; slow |= t; }
            lat.Add(worst); if (slow) hitSlow++;
        }
        lat.Sort();
        long Pct(long p) => lat[(int)((p * n + 99) / 100 - 1)];
        return new Result(Pct(50), Pct(95), Pct(99), delay, s, hitSlow * 100 / n, hedges * Milli / ((long)n * fanout));
    }

    static void Show(string label, Result r) =>
        Console.WriteLine($"{label.PadRight(26)} p50={r.P50.ToString().PadLeft(3)} p95={r.P95.ToString().PadLeft(4)} p99={r.P99.ToString().PadLeft(4)} hit-slow={r.HitSlowPct.ToString().PadLeft(2)}% hedge-delay={r.Delay.ToString().PadLeft(3)}ms extra-load={r.ExtraPm / 10}.{r.ExtraPm % 10}%");

    static void Check(bool ok, string msg) { if (!ok) { Console.Error.WriteLine(msg); Environment.Exit(1); } }

    static void Main()
    {
        Console.WriteLine("1 - 0.99^N: " + string.Join(", ", new[] { 1, 10, 50, 100 }.Select(f => $"N={f} {(int)Math.Floor(100 * (1 - Math.Pow(0.99, f)))}%")));
        var off = Run(Fanout, 0, Replicas, LoadPct); var p95 = Run(Fanout, 95, Replicas, LoadPct); var p50 = Run(Fanout, 50, Replicas, LoadPct); var p95b = Run(Fanout, 95, Replicas, LoadPct, budget: true);
        Console.WriteLine("fan-out 50 shards, 50% load, 2 replicas");
        Show("no hedging", off); Show("hedge after p95", p95); Show("hedge after p95 + budget", p95b); Show("hedge after p50", p50);
        var lone = Run(1, 0, Replicas, LoadPct); var loneH = Run(1, 95, Replicas, LoadPct);
        Console.WriteLine("fan-out 1"); Show("no hedging", lone); Show("hedge after p95", loneH);
        Console.WriteLine($"p95 delay {DelayFor(95, Milli)} ms, p50 delay {DelayFor(50, Milli)} ms");

        Check(p95.P99 < off.P99, "hedging at p95 must reduce p99");
        Check(p95.ExtraPm < MaxHedgeLoadPm, "hedging at p95 must add under 10% load");
        Check(p50.ExtraPm > P50CostRatio * p95.ExtraPm, "hedging at p50 must cost far more than at p95");
        Check(p95b.ExtraPm <= BudgetEarn * Milli / HedgeCost, "the budget must cap the extra load at 5%");
        Console.WriteLine("invariants hold");
    }
}
