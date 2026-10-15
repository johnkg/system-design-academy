// A progressive rollout in C#: regions go one after another (waves), each wave grows the new version in stages,
// and every stage compares the new version's error rate with the old version's, running side by side, using a one-sided z-test.
using System;
using System.Linq;

int[] stages = { 1, 10, 50 }; // percent of a region's traffic on the new version; after the last stage the region is promoted to 100%
var regions = new (string Name, long Requests)[] { ("sa", 20000), ("eu", 60000), ("us", 120000) };
const long MinCanary = 300;   // fewer requests than this prove nothing, so the bake time is extended
const double ZLimit = 2.33;   // one-sided, about a 1% chance of a false alarm per check
long total = regions.Sum(r => r.Requests);

long seed = 7;
bool Chance(int per10000)
{
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return (seed / 65536) % 10000 < per10000;
}
long Errors(long n, int rate) { long e = 0; for (long i = 0; i < n; i++) if (Chance(rate)) e++; return e; }

// Prints hundredths as text, such as -118 -> -1.18, so every language shows the same digits.
string Fmt2(long h) => $"{(h < 0 ? "-" : "")}{Math.Abs(h) / 100}.{Math.Abs(h) % 100:00}";

// z statistic with a pooled error rate: how many standard errors the canary is above the baseline
double ZScore(long ec, long nc, long eb, long nb)
{
    double p = (double)(ec + eb) / (nc + nb);
    double se = Math.Sqrt(p * (1 - p) * (1.0 / nc + 1.0 / nb));
    return se == 0 ? 0 : ((double)ec / nc - (double)eb / nb) / se;
}

(bool Done, long Exposed, int Steps) Rollout(string name, int canaryRate)
{
    const int baseRate = 100; // the old version fails 1% of requests (rates are per 10,000)
    long exposed = 0; int steps = 0;
    Console.WriteLine($"release {name} (real error rate {canaryRate / 100.0}%)");
    foreach (var (region, requests) in regions)
    {
        foreach (int pct in stages)
        {
            long nc = requests * pct / 100, mult = 1;
            while (nc * mult < MinCanary) mult *= 2; // wait longer until there is enough traffic
            nc *= mult;
            long nb = requests * mult - nc;
            long ec = Errors(nc, canaryRate), eb = Errors(nb, baseRate);
            double z = ZScore(ec, nc, eb, nb);
            bool bad = z > ZLimit;
            exposed += nc; steps++;
            Console.WriteLine($"  {region} {pct}%: {nc} canary requests, {ec} errors, z={Fmt2((long)Math.Floor(z * 100))} -> {(bad ? "ROLL BACK" : "ok")}");
            if (bad) return (false, exposed, steps);
        }
    }
    return (true, exposed, steps);
}

var good = Rollout("v2", 100);
var badRelease = Rollout("v3", 200);
double share = badRelease.Exposed * 100.0 / total;
Console.WriteLine($"v2 finished: {good.Done.ToString().ToLower()}, v3 finished: {badRelease.Done.ToString().ToLower()}");
Console.WriteLine($"v3 was seen by {badRelease.Exposed} of {total} requests ({Fmt2((long)Math.Floor(share * 100))}%) before the rollback, {badRelease.Steps} checks");
if (!good.Done || badRelease.Done || badRelease.Exposed > total / 50.0 || badRelease.Steps != 2) Environment.Exit(1);
