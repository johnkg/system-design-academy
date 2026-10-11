// Cost of labels and sampling: series cardinality, head vs tail sampling, and reweighted estimators.
// Integer-only random numbers so the output is identical in every language.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

const int N = 100000;       // 2 seconds of traffic at 50,000 requests per second
const int SlowMs = 800;     // tail sampling keeps anything at least this slow
const uint Seed = 5;
CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

uint Mix(uint x) // 32-bit hash finalizer (murmur3)
{
    unchecked
    {
        x = (x ^ (x >> 16)) * 0x85ebca6bu;
        x = (x ^ (x >> 13)) * 0xc2b2ae35u;
        return x ^ (x >> 16);
    }
}
bool HeadKeep(uint id, int d, uint salt = 0x9e3779b9u) => (long)Mix(id ^ salt) < 4294967296L / d;
bool Interesting(Ev e) => e.Err || e.Ms >= SlowMs;

// Mulberry32 over a captured state.
uint a = Seed;
uint Rng()
{
    unchecked
    {
        a += 0x6d2b79f5u;
        uint t = (a ^ (a >> 15)) * (1u | a);
        t = (t + (t ^ (t >> 7)) * (61u | t)) ^ t;
        return t ^ (t >> 14);
    }
}
var stream = new List<Ev>(); // 0.2% errors (slow timeouts), 1% slow successes, the rest fast
for (int i = 0; i < N; i++)
{
    uint id = Rng(), u = Rng() % 100000;
    bool err = false; long ms;
    if (u < 200) { err = true; ms = 1500 + Rng() % 2500; }
    else if (u < 1200) ms = SlowMs + Rng() % 2200;
    else { ms = 20 + Rng() % 60; ms += Rng() % 60; ms += Rng() % 60; }
    stream.Add(new Ev(id, err, ms));
}

long WeightedQuantile(List<(long ms, long w)> items, int pct) // smallest ms with >= pct% of the weight below
{
    var s = items.OrderBy(x => x.ms).ToList();
    long total = s.Sum(x => x.w), cum = 0;
    foreach (var (ms, w) in s) { cum += w; if (cum * 100 >= pct * total) return ms; }
    return -1;
}
(double, double) Wilson(int k, int n) // 95% interval for a proportion
{
    double z = 1.96, p = (double)k / n, d = 1 + z * z / n;
    double c = (p + z * z / (2 * n)) / d, h = (z * Math.Sqrt(p * (1 - p) / n + z * z / (4.0 * n * n))) / d;
    return (c - h, c + h);
}

int trueErrors = stream.Count(e => e.Err);
Console.WriteLine($"stream: {N} requests, {trueErrors} errors, true p99 {WeightedQuantile(stream.Select(e => (e.Ms, 1L)).ToList(), 99)} ms");

(int errsKept, long estTotal, double se) Run(int d, bool tail)
{
    var kept = stream.Where(e => HeadKeep(e.Id, d) || (tail && Interesting(e))).ToList();
    int errsKept = kept.Count(e => e.Err);
    long Weight(Ev e) => tail && Interesting(e) ? 1 : d; // each kept event stands for 1/rate events
    long estTotal = kept.Sum(Weight);
    int normalKept = kept.Count(e => !(tail && Interesting(e)));
    double se = Math.Sqrt((double)normalKept * d * (d - 1)); // std dev of the reweighted total
    long p99 = WeightedQuantile(kept.Select(e => (e.Ms, Weight(e))).ToList(), 99);
    long naive = WeightedQuantile(kept.Select(e => (e.Ms, 1L)).ToList(), 99);
    double relErr = (double)(estTotal - N) / N * 100, rate, lo, hi;
    if (tail)
    {
        rate = (double)errsKept / estTotal; // errors are exact, only the denominator is estimated
        lo = errsKept / (estTotal + 1.96 * se); hi = errsKept / (estTotal - 1.96 * se);
    }
    else
    {
        rate = kept.Count > 0 ? (double)errsKept / kept.Count : 0;
        (lo, hi) = Wilson(errsKept, kept.Count);
    }
    string Pc(double x) => (x * 100).ToString("F3");
    Console.WriteLine($"{(tail ? "tail" : "head")} 1/{d}: kept {kept.Count}, errors kept {errsKept}/{trueErrors}, count est {estTotal} ({relErr:F2}%), " +
        $"error rate {Pc(rate)}% [{Pc(lo)}, {Pc(hi)}], p99 {p99} ms, unweighted p99 {naive} ms");
    return (errsKept, estTotal, se);
}

foreach (int d in new[] { 1, 10, 100, 1000 })
{
    var r = Run(d, false);
    if (Math.Abs(r.estTotal - N) > 4 * r.se) throw new Exception($"head 1/{d} count estimate off");
    if (d == 1 && r.errsKept != trueErrors) throw new Exception("keep-everything must keep every error");
}
foreach (int d in new[] { 10, 100, 1000 })
{
    var r = Run(d, true);
    if (r.errsKept != trueErrors) throw new Exception("tail sampling lost an error");
    if (Math.Abs(r.estTotal - N) > 4 * r.se) throw new Exception($"tail 1/{d} count estimate off");
}

// Three services on the request path, each deciding at 1/10.
int consistent = stream.Count(e => HeadKeep(e.Id, 10) && HeadKeep(e.Id, 10) && HeadKeep(e.Id, 10));
int independent = stream.Count(e => HeadKeep(e.Id, 10, 1) && HeadKeep(e.Id, 10, 2) && HeadKeep(e.Id, 10, 3));
Console.WriteLine($"complete traces across 3 services at 1/10: by trace id {consistent}, independent coins {independent}");
if (consistent <= independent) throw new Exception("consistent sampling must keep more complete traces");

// Metric cardinality: one series per unique label combination.
var labels = new Dictionary<string, long> { ["route"] = 20, ["status"] = 5, ["region"] = 6, ["customer_id"] = 1000000 };
const long SeriesBytes = 3072; // about 3 KB of memory per active series
long Series(params string[] names) => names.Aggregate(1L, (p, n) => p * labels[n]);
foreach (var names in new[] { new[] { "route", "status" }, new[] { "route", "status", "region" }, new[] { "route", "status", "region", "customer_id" } })
{
    long s = Series(names);
    Console.WriteLine($"labels {string.Join("+", names)}: {s} series, {(s * SeriesBytes / 1e9):F2} GB");
}
if (Series("route", "status", "region") != 600) throw new Exception("cardinality is the product");
Console.WriteLine("ok");

record Ev(uint Id, bool Err, long Ms);
