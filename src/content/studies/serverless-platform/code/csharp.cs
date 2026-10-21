// A tiny serverless platform, in C#:
// every instance runs one request at a time, the router reuses a warm idle instance or starts a cold one (if the cap allows),
// idle instances are reaped after a timeout, and provisioned instances stay for ever.
using System;
using System.Collections.Generic;
using System.Linq;

const long MsPerS = 1000;
const int Seconds = 600; // ten minutes of traffic
const int Seed = 7;
const int SteadyRate = 40; // requests per second
const int BurstPeriod = 90; // bursty: 150 rps for 8 s every 90 s, 15 rps otherwise
const int BurstLen = 8;
const int BurstRate = 150;
const int QuietRate = 15;
const int SpikeLen = 6; // spiky: 250 rps for 6 s at each spike start, silence otherwise
const int SpikeRate = 250;
const int MinRunMs = 50; // a request runs 50..149 ms
const int RunSpreadMs = 100;
const int MsPerMicro = 60; // price: one millionth of a dollar per 60 billed ms, per 240 provisioned ms and per 5 requests
const int ProvisionedMsPerMicro = 240;
const int RequestsPerMicro = 5;
const int CostRatio = 3; // provisioned concurrency must cost at least this many times more
const long End = Seconds * MsPerS; // in milliseconds
int[] spikeStarts = { 30, 270, 510 };
const long KeptFirst = 1_000_000_000_000L; // ranks provisioned instances above any busy-until time
long seed = Seed;
long Random(long n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (seed / 65536) % n; }

// Requests per second for each pattern. Every request has a start time and a run time of 50 to 149 ms.
List<Req> Traffic(string pattern)
{
    seed = Seed;
    var requests = new List<Req>();
    for (int s = 0; s < Seconds; s++)
    {
        int rate = SteadyRate; // steady
        if (pattern == "bursty") rate = s % BurstPeriod < BurstLen ? BurstRate : QuietRate;
        if (pattern == "spiky") rate = spikeStarts.Any(a => s >= a && s < a + SpikeLen) ? SpikeRate : 0;
        for (int i = 0; i < rate; i++) requests.Add(new Req(s * MsPerS + Random(MsPerS), MinRunMs + Random(RunSpreadMs), requests.Count));
    }
    return requests.OrderBy(r => r.T).ThenBy(r => r.N).ToList();
}

Result Run(List<Req> requests, long idleSeconds, int provisioned, long initMs, int cap)
{
    long idle = idleSeconds * MsPerS;
    var pool = Enumerable.Range(0, provisioned).Select(_ => new Inst { Kept = true }).ToList();
    int cold = 0, throttled = 0, peak = provisioned;
    long billedMs = 0, idleMs = 0;
    var latencies = new List<long>();
    long Rank(Inst x) => (x.Kept ? KeptFirst : 0) + x.BusyUntil;
    foreach (var r in requests)
    {
        // Reap on-demand instances that have been idle for longer than the timeout.
        pool = pool.Where(x =>
        {
            bool dead = !x.Kept && x.BusyUntil <= r.T && x.BusyUntil + idle < r.T;
            if (dead) idleMs += idle;
            return !dead;
        }).ToList();
        // Prefer a free provisioned instance, then the most recently used free one (so the others can go idle and be reaped).
        Inst? best = null;
        foreach (var x in pool) if (x.BusyUntil <= r.T && (best == null || Rank(x) > Rank(best))) best = x;
        if (best != null)
        {
            if (!best.Kept) idleMs += r.T - best.BusyUntil;
            best.BusyUntil = r.T + r.Ms; latencies.Add(r.Ms); billedMs += r.Ms;
        }
        else if (pool.Count < cap) // scale from zero: a new instance pays the start before it runs
        {
            cold++; pool.Add(new Inst { BusyUntil = r.T + initMs + r.Ms });
            latencies.Add(initMs + r.Ms); billedMs += initMs + r.Ms; peak = Math.Max(peak, pool.Count);
        }
        else throttled++; // at the cap: rejected
    }
    foreach (var x in pool) if (!x.Kept) idleMs += Math.Max(0, Math.Min(idle, End - x.BusyUntil));
    latencies.Sort();
    long Pct(int p) => latencies[(int)((latencies.Count * (long)p + 99) / 100 - 1)]; // nearest rank
    long costMicro = billedMs / MsPerMicro + provisioned * End / ProvisionedMsPerMicro + latencies.Count / RequestsPerMicro; // millionths of a dollar
    return new Result(cold, throttled, latencies.Count, peak, Pct(50), Pct(95), Pct(99), billedMs, idleMs / MsPerS, costMicro);
}

void Show(string label, (long Idle, int Prov, long Init, int Cap) c, Result r) =>
    Console.WriteLine($"{label} (idle {c.Idle} s, provisioned {c.Prov}, init {c.Init} ms, cap {c.Cap}): cold {r.Cold}, throttled {r.Throttled}, p50/p95/p99 {r.P50}/{r.P95}/{r.P99} ms, billed {r.BilledMs} ms, warm idle {r.IdleSeconds} s, cost {r.CostMicro} micro-dollars");

Result RunWith(List<Req> reqs, (long Idle, int Prov, long Init, int Cap) c) => Run(reqs, c.Idle, c.Prov, c.Init, c.Cap);

var baseCfg = (Idle: 60L, Prov: 0, Init: 800L, Cap: 100);
var requestsBy = new Dictionary<string, List<Req>>();
foreach (var pattern in new[] { "steady", "bursty", "spiky" })
{
    requestsBy[pattern] = Traffic(pattern);
    var r = RunWith(requestsBy[pattern], baseCfg);
    Show($"{pattern,-6} {requestsBy[pattern].Count} requests", baseCfg, r);
    if (r.Served + r.Throttled != requestsBy[pattern].Count || r.Peak > baseCfg.Cap) Environment.Exit(1);
}

Console.WriteLine("--- the same spiky traffic with one change at a time");
var spiky = requestsBy["spiky"];
var results = new Dictionary<string, Result>();
var changes = new (string, (long Idle, int Prov, long Init, int Cap))[]
{
    ("baseline", baseCfg), ("longer idle timeout", (240, 0, 800, 100)), ("provisioned 30", (60, 30, 800, 100)),
    ("faster init", (60, 0, 200, 100)), ("higher cap", (60, 0, 800, 300)),
};
foreach (var (name, cfg) in changes)
{
    results[name] = RunWith(spiky, cfg);
    Show($"{name,-19}", cfg, results[name]);
}
var b = results["baseline"];
bool ok = b.Throttled > 0 && b.Cold > 0
    && results["longer idle timeout"].Cold < b.Cold // survives the 234 s of silence
    && results["higher cap"].Throttled < b.Throttled
    && results["faster init"].P99 < b.P99
    && results["provisioned 30"].CostMicro > CostRatio * b.CostMicro; // paying all day for a 6-second spike
Console.WriteLine($"each change helps what it should, and provisioned concurrency costs more: {(ok ? "true" : "false")}");
if (!ok) Environment.Exit(1);

record Req(long T, long Ms, int N);
record Result(int Cold, int Throttled, int Served, int Peak, long P50, long P95, long P99, long BilledMs, long IdleSeconds, long CostMicro);
class Inst { public long BusyUntil; public bool Kept; }
