// Paired comparison of an old and a new model on the same seeded eval set, with a normal-approximation CI,
// a bootstrap CI and a release gate. Everything is integer arithmetic except the final square root.
using System;
using System.Linq;

const int EvalSeed = 20240601, BootstrapSeed = 7;
const int DifficultyRange = 1000; // item difficulty z is 0..999
const int Noise = 150; // run-to-run noise is -150..+150
const int PassBelow = 700; // a model passes an item when z + noise is under this (about 70% accuracy)
const int DifficultyPerPt = DifficultyRange / 100; // one accuracy point moves the threshold by 10
const int Resamples = 1000, Tail = Resamples / 40; // bootstrap resamples, 2.5% of them in each tail
const double Z95 = 1.96; // two-sided 95% normal quantile
const double NonInferiority = 0.02; // ship unless the new model may be more than 2 points worse
const int SmallN = 100, LargeN = 1000, GainPts = 3;

Func<long, Func<long>> lcg = seed => { long x = seed; return () => x = (x * 48271) % 2147483647; };

// Item i is hard or easy (z). Each model passes when z plus its own run-to-run noise is under a threshold.
(int[] d, int passOld, int passNew) EvalSet(int n, int deltaPts)
{
    var r = lcg(EvalSeed);
    var d = new int[n]; int passOld = 0, passNew = 0;
    for (int i = 0; i < n; i++)
    {
        long z = r() % DifficultyRange, noiseOld = (r() % (2 * Noise + 1)) - Noise, noiseNew = (r() % (2 * Noise + 1)) - Noise;
        int o = z + noiseOld < PassBelow ? 1 : 0;
        int w = z + noiseNew < PassBelow + deltaPts * DifficultyPerPt ? 1 : 0;
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
    var r = lcg(BootstrapSeed); var sums = new int[Resamples];
    for (int b = 0; b < Resamples; b++) { int t = 0; for (int k = 0; k < n; k++) t += d[(int)(r() % n)]; sums[b] = t; }
    Array.Sort(sums);
    double lo = mean - Z95 * se, hi = mean + Z95 * se;
    double bLo = (double)sums[Tail] / n, bHi = (double)sums[Resamples - Tail - 1] / n;          // 2.5th and 97.5th percentile of 1000 resamples
    string gate = lo > -NonInferiority ? "ship" : "block";                             // non-inferiority: lower bound not below -2 points
    string label = lo > 0 ? "better" : hi < 0 ? "worse" : "inconclusive";
    Console.WriteLine($"n={n,4} change={(deltaPts >= 0 ? "+" : "")}{deltaPts} old={Fmt(p1)}% new={Fmt(p2)}% diff={Fmt(mean)}");
    Console.WriteLine($"  normal CI {Fmt(lo)}..{Fmt(hi)}  bootstrap CI {Fmt(bLo)}..{Fmt(bHi)}  paired width {Fmt(hi - lo)} vs unpaired {Fmt(2 * Z95 * seUnpaired)}");
    Console.WriteLine($"  verdict: {label}, gate: {gate}");
    if (!(lo <= mean && mean <= hi && bLo <= mean && mean <= bHi)) throw new Exception("mean outside its own interval");
    if (!(hi - lo < 2 * Z95 * seUnpaired)) throw new Exception("pairing should narrow the interval");
    return (hi - lo, gate);
}

var small = Compare(SmallN, GainPts); var large = Compare(LargeN, GainPts);
Compare(LargeN, -GainPts);
Compare(200, 0);
if (!(large.width < small.width)) throw new Exception("more items must narrow the interval");
Console.WriteLine($"gate at n=100: {small.gate}, at n=1000: {large.gate}");
