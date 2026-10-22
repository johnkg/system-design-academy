// An experimentation core in C#: hash bucketing, ramp-ups, layers, a sample-ratio check and a significance test with peeking.
// All maths on counts is exact; the draws come from a seeded integer generator, so every run prints the same numbers.
using System;
using System.Collections.Generic;
using System.Linq;

const int SeedValue = 7, UserCount = 40000;
const double LayerTolerance = 0.02; // overlap of independent layers may drift this far from the expected share
const int ControlRate = 1000, TreatmentRate = 1150; // conversion in basis points: 10.00% and 11.50%
const double Chi2Limit = 3.841; // chi-square (1 degree of freedom) at the 5% level
const double ZSum = 2.8, BaseRate = 0.1, Lift = 0.01; // 1.96 + 0.84 for 5% significance and 80% power
const int DailyUsers = 2000;
const int AaTests = 400, Looks = 20, LookSize = 100;
const double Z95Squared = 3.8416, WideZSquared = 9.61; // 1.96 squared, and 3.1 squared

var users = Enumerable.Range(1, UserCount).Select(i => $"u{i}").ToArray();
var expA = new Exp("exp-a", "checkout", 0, Lab.Half, 100);
var expB = new Exp("exp-b", "checkout", Lab.Half, Lab.Buckets, Lab.Buckets);
var expC = new Exp("exp-c", "search", 0, Lab.Half, Lab.Buckets);
var fullA = expA with { Ramp = Lab.Buckets };
Console.WriteLine($"u1 buckets: arm {Lab.Bucket("exp-a:arm", "u1")}, ramp {Lab.Bucket("exp-a:ramp", "u1")}, layer {Lab.Bucket("layer-checkout", "u1")}");

// 1. Ramp-up: everyone in at 1% stays in at 5% and 25%, with the same arm.
var previous = new Dictionary<string, string>();
foreach (var ramp in new[] { 100, 500, 2500, 10000 })
{
    var now = new Dictionary<string, string>();
    foreach (var u in users) { var a = (expA with { Ramp = ramp }).Assign(u); if (a != null) now[u] = a; }
    bool kept = previous.All(p => now.GetValueOrDefault(p.Key) == p.Value);
    Console.WriteLine($"ramp {ramp / Lab.BucketsPerPercent}%: {now.Count} users, earlier users kept their arm: {(kept ? "true" : "false")}");
    if (!kept) return 1;
    previous = now;
}

// 2. Layers: A and B share a layer, so they never overlap. C is in another layer and overlaps both independently.
var rows = users.Select(u => (a: fullA.Assign(u), b: expB.Assign(u), c: expC.Assign(u))).ToArray();
int inA = rows.Count(r => r.a != null), inB = rows.Count(r => r.b != null), inC = rows.Count(r => r.c != null);
int both = rows.Count(r => r.a != null && r.b != null), inAC = rows.Count(r => r.a != null && r.c != null);
Console.WriteLine($"layer checkout: A {inA}, B {inB}, in both {both}; in A and C {inAC} of {inA} (C has {inC} of {users.Length})");
if (both != 0 || Math.Abs((double)inAC / inA - (double)inC / users.Length) > LayerTolerance) return 1;

// 3. Outcomes for experiment A at full ramp: control converts at 10.00%, treatment at 11.50%.
var rng = new Rng(SeedValue);
long[] n = { 0, 0 }, c = { 0, 0 };
foreach (var u in users)
{
    var a = fullA.Assign(u);
    if (a == null) continue;
    int k = a == "treatment" ? 1 : 0;
    n[k]++;
    if (rng.Draw() < (k == 1 ? TreatmentRate : ControlRate)) c[k]++;
}
double chi = Lab.SrmChi(n[0], n[1]), z2 = Lab.ZSquared(n[0], c[0], n[1], c[1]);
Console.WriteLine($"control {c[0]}/{n[0]}, treatment {c[1]}/{n[1]}; sample-ratio chi2 {Lab.Milli(chi)} (limit 3.841), z2 {Lab.Milli(z2)} (limit 3.841)");
if (chi > Chi2Limit || z2 < Chi2Limit) return 1;

// 4. Sample size per arm for a 1 point lift on a 10% rate: 2 * (1.96 + 0.84)^2 * p(1-p) / delta^2, and the days it takes at 2,000 enrolled users a day.
int perArm = (int)Math.Ceiling((2 * ZSum * ZSum * BaseRate * (1 - BaseRate)) / (Lift * Lift));
Console.WriteLine($"needs {perArm} users per arm, which is {(2 * perArm + DailyUsers - 1) / DailyUsers} days at 2000 users a day");

// 5. Peeking: 400 A/A tests (no real difference), 20 looks of 100 users per arm. Stop at the first look past the limit.
int fixedHits = 0, peekHits = 0, boundHits = 0;
for (int t = 0; t < AaTests; t++)
{
    long ca = 0, cb = 0; bool early = false, bound = false; double last = 0;
    for (int look = 1; look <= Looks; look++)
    {
        for (int i = 0; i < LookSize; i++) { if (rng.Draw() < ControlRate) ca++; if (rng.Draw() < ControlRate) cb++; }
        last = ca + cb > 0 ? Lab.ZSquared(look * LookSize, ca, look * LookSize, cb) : 0;
        if (last > Z95Squared) early = true;   // any look past 1.96
        if (last > WideZSquared) bound = true;     // any look past 3.1, a wider limit that pays for 20 looks
    }
    if (last > Z95Squared) fixedHits++;
    if (early) peekHits++;
    if (bound) boundHits++;
}
Console.WriteLine($"false wins in 400 A/A tests: one look at the end {fixedHits}, stopping at any of 20 looks {peekHits}, with the wider limit {boundHits}");
return peekHits > fixedHits * 2 && boundHits < peekHits ? 0 : 1;

// layer: experiments in one layer own separate slices of 0..9999, so a user is in at most one of them.
record Exp(string Salt, string Layer, int Lo, int Hi, int Ramp)
{
    public string? Assign(string user)
    {
        int layer = Lab.Bucket("layer-" + Layer, user);
        if (layer < Lo || layer >= Hi) return null;
        if (Lab.Bucket(Salt + ":ramp", user) >= Ramp) return null;                      // not ramped in yet
        return Lab.Bucket(Salt + ":arm", user) < Lab.Half ? "treatment" : "control";        // the arm does not depend on the ramp
    }
}

class Rng
{
    uint seed;
    public Rng(uint s) { seed = s; }
    public int Draw() { seed = unchecked(seed * 1664525u + 1013904223u); return (int)((seed >> 16) % Lab.Buckets); } // 0..9999
}

static class Lab
{
    public const int Buckets = 10000, Half = Buckets / 2, BucketsPerPercent = Buckets / 100; // buckets 0..9999; rates in basis points
    static uint Fnv1a(string s) { uint h = 2166136261; foreach (char ch in s) { h ^= ch; h = unchecked(h * 16777619u); } return h; }

    // A salt plus the user id gives a number in 0..9999. The finalizer mixes the bits so the low digits are even.
    public static int Bucket(string salt, string user)
    {
        uint h = Fnv1a($"{salt}:{user}");
        h ^= h >> 15; h = unchecked(h * 2246822519u); h ^= h >> 13;
        return (int)(h % Buckets);
    }

    // Two-proportion z test as z squared (no square root needed), and the chi-square for a 50/50 split.
    public static double ZSquared(double n1, double c1, double n2, double c2)
    {
        double p = (c1 + c2) / (n1 + n2), d = c1 / n1 - c2 / n2;
        return (d * d) / (p * (1 - p) * (1 / n1 + 1 / n2));
    }
    public static double SrmChi(double a, double b) => ((a - b) * (a - b)) / (a + b);

    public static string Milli(double x) { long m = (long)Math.Floor(x * 1000 + 0.5); return $"{m / 1000}.{m % 1000:D3}"; } // 3 decimals, formatted by hand
}
