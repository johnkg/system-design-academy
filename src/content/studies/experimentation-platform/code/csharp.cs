// An experimentation core in C#: hash bucketing, ramp-ups, layers, a sample-ratio check and a significance test with peeking.
// All maths on counts is exact; the draws come from a seeded integer generator, so every run prints the same numbers.
using System;
using System.Collections.Generic;
using System.Linq;

var users = Enumerable.Range(1, 40000).Select(i => $"u{i}").ToArray();
var expA = new Exp("exp-a", "checkout", 0, 5000, 100);
var expB = new Exp("exp-b", "checkout", 5000, 10000, 10000);
var expC = new Exp("exp-c", "search", 0, 5000, 10000);
var fullA = expA with { Ramp = 10000 };
Console.WriteLine($"u1 buckets: arm {Lab.Bucket("exp-a:arm", "u1")}, ramp {Lab.Bucket("exp-a:ramp", "u1")}, layer {Lab.Bucket("layer-checkout", "u1")}");

// 1. Ramp-up: everyone in at 1% stays in at 5% and 25%, with the same arm.
var previous = new Dictionary<string, string>();
foreach (var ramp in new[] { 100, 500, 2500, 10000 })
{
    var now = new Dictionary<string, string>();
    foreach (var u in users) { var a = (expA with { Ramp = ramp }).Assign(u); if (a != null) now[u] = a; }
    bool kept = previous.All(p => now.GetValueOrDefault(p.Key) == p.Value);
    Console.WriteLine($"ramp {ramp / 100}%: {now.Count} users, earlier users kept their arm: {(kept ? "true" : "false")}");
    if (!kept) return 1;
    previous = now;
}

// 2. Layers: A and B share a layer, so they never overlap. C is in another layer and overlaps both independently.
var rows = users.Select(u => (a: fullA.Assign(u), b: expB.Assign(u), c: expC.Assign(u))).ToArray();
int inA = rows.Count(r => r.a != null), inB = rows.Count(r => r.b != null), inC = rows.Count(r => r.c != null);
int both = rows.Count(r => r.a != null && r.b != null), inAC = rows.Count(r => r.a != null && r.c != null);
Console.WriteLine($"layer checkout: A {inA}, B {inB}, in both {both}; in A and C {inAC} of {inA} (C has {inC} of {users.Length})");
if (both != 0 || Math.Abs((double)inAC / inA - (double)inC / users.Length) > 0.02) return 1;

// 3. Outcomes for experiment A at full ramp: control converts at 10.00%, treatment at 11.50%.
var rng = new Rng(7);
long[] n = { 0, 0 }, c = { 0, 0 };
foreach (var u in users)
{
    var a = fullA.Assign(u);
    if (a == null) continue;
    int k = a == "treatment" ? 1 : 0;
    n[k]++;
    if (rng.Draw() < (k == 1 ? 1150 : 1000)) c[k]++;
}
double chi = Lab.SrmChi(n[0], n[1]), z2 = Lab.ZSquared(n[0], c[0], n[1], c[1]);
Console.WriteLine($"control {c[0]}/{n[0]}, treatment {c[1]}/{n[1]}; sample-ratio chi2 {Lab.Milli(chi)} (limit 3.841), z2 {Lab.Milli(z2)} (limit 3.841)");
if (chi > 3.841 || z2 < 3.841) return 1;

// 4. Sample size per arm for a 1 point lift on a 10% rate: 2 * (1.96 + 0.84)^2 * p(1-p) / delta^2, and the days it takes at 2,000 enrolled users a day.
int perArm = (int)Math.Ceiling((2 * 2.8 * 2.8 * 0.1 * 0.9) / (0.01 * 0.01));
Console.WriteLine($"needs {perArm} users per arm, which is {(2 * perArm + 1999) / 2000} days at 2000 users a day");

// 5. Peeking: 400 A/A tests (no real difference), 20 looks of 100 users per arm. Stop at the first look past the limit.
int fixedHits = 0, peekHits = 0, boundHits = 0;
for (int t = 0; t < 400; t++)
{
    long ca = 0, cb = 0; bool early = false, bound = false; double last = 0;
    for (int look = 1; look <= 20; look++)
    {
        for (int i = 0; i < 100; i++) { if (rng.Draw() < 1000) ca++; if (rng.Draw() < 1000) cb++; }
        last = ca + cb > 0 ? Lab.ZSquared(look * 100, ca, look * 100, cb) : 0;
        if (last > 3.8416) early = true;   // any look past 1.96
        if (last > 9.61) bound = true;     // any look past 3.1, a wider limit that pays for 20 looks
    }
    if (last > 3.8416) fixedHits++;
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
        return Lab.Bucket(Salt + ":arm", user) < 5000 ? "treatment" : "control";        // the arm does not depend on the ramp
    }
}

class Rng
{
    uint seed;
    public Rng(uint s) { seed = s; }
    public int Draw() { seed = unchecked(seed * 1664525u + 1013904223u); return (int)((seed >> 16) % 10000); } // 0..9999
}

static class Lab
{
    static uint Fnv1a(string s) { uint h = 2166136261; foreach (char ch in s) { h ^= ch; h = unchecked(h * 16777619u); } return h; }

    // A salt plus the user id gives a number in 0..9999. The finalizer mixes the bits so the low digits are even.
    public static int Bucket(string salt, string user)
    {
        uint h = Fnv1a($"{salt}:{user}");
        h ^= h >> 15; h = unchecked(h * 2246822519u); h ^= h >> 13;
        return (int)(h % 10000);
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
