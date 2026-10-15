// Paired comparison of an old and a new model on the same seeded eval set, with a normal-approximation CI,
// a bootstrap CI and a release gate. Everything is integer arithmetic except the final square root.
using System;
using System.Linq;

Func<long, Func<long>> lcg = seed => { long x = seed; return () => x = (x * 48271) % 2147483647; };

// Item i is hard or easy (z). Each model passes when z plus its own run-to-run noise is under a threshold.
(int[] d, int passOld, int passNew) EvalSet(int n, int deltaPts)
{
    var r = lcg(20240601);
    var d = new int[n]; int passOld = 0, passNew = 0;
    for (int i = 0; i < n; i++)
    {
        long z = r() % 1000, noiseOld = (r() % 301) - 150, noiseNew = (r() % 301) - 150;
        int o = z + noiseOld < 700 ? 1 : 0;
        int w = z + noiseNew < 700 + deltaPts * 10 ? 1 : 0;
        passOld += o; passNew += w; d[i] = w - o; // per-item paired difference: -1, 0 or +1
    }
    return (d, passOld, passNew);
}

string Fmt(double v) // fraction -> percentage points, 2 decimals, round half up, same in every language
{
    double x = v * 100; long k = (long)Math.Floor(Math.Abs(x) * 100 + 0.5);
    return (x < 0 && k > 0 ? "-" : "") + (k / 100) + "." + (k % 100).ToString().PadLeft(2, '0');
}

(double width, string gate) Compare(int n, int deltaPts)
{
    var (d, passOld, passNew) = EvalSet(n, deltaPts);
    int total = d.Sum(), sumSq = d.Sum(v => v * v);
    double mean = (double)total / n;
    double se = Math.Sqrt((sumSq - n * mean * mean) / (n - 1) / n);          // paired standard error
    double p1 = (double)passOld / n, p2 = (double)passNew / n;
    double seUnpaired = Math.Sqrt((p1 * (1 - p1) + p2 * (1 - p2)) / n);      // what you would get by ignoring the pairing
    var r = lcg(7); var sums = new int[1000];
    for (int b = 0; b < 1000; b++) { int t = 0; for (int k = 0; k < n; k++) t += d[(int)(r() % n)]; sums[b] = t; }
    Array.Sort(sums);
    double lo = mean - 1.96 * se, hi = mean + 1.96 * se;
    double bLo = (double)sums[25] / n, bHi = (double)sums[974] / n;           // 2.5th and 97.5th percentile of 1000 resamples
    string gate = lo > -0.02 ? "ship" : "block";                              // non-inferiority: lower bound not below -2 points
    string label = lo > 0 ? "better" : hi < 0 ? "worse" : "inconclusive";
    Console.WriteLine($"n={n,4} change={(deltaPts >= 0 ? "+" : "")}{deltaPts} old={Fmt(p1)}% new={Fmt(p2)}% diff={Fmt(mean)}");
    Console.WriteLine($"  normal CI {Fmt(lo)}..{Fmt(hi)}  bootstrap CI {Fmt(bLo)}..{Fmt(bHi)}  paired width {Fmt(hi - lo)} vs unpaired {Fmt(2 * 1.96 * seUnpaired)}");
    Console.WriteLine($"  verdict: {label}, gate: {gate}");
    if (!(lo <= mean && mean <= hi && bLo <= mean && mean <= bHi)) throw new Exception("mean outside its own interval");
    if (!(hi - lo < 2 * 1.96 * seUnpaired)) throw new Exception("pairing should narrow the interval");
    return (hi - lo, gate);
}

var small = Compare(100, 3); var large = Compare(1000, 3);
Compare(1000, -3);
Compare(200, 0);
if (!(large.width < small.width)) throw new Exception("more items must narrow the interval");
Console.WriteLine($"gate at n=100: {small.gate}, at n=1000: {large.gate}");
