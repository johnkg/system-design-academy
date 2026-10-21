// LLM caching and routing: an exact cache, a semantic cache (toy 4-number "embeddings") and a
// two-model cascade, replayed over the same seeded workload. All money is integer nano-dollars.
using System;
using System.Collections.Generic;
using System.Linq;

int[][] VEC = { new[] { 9, 1, 2, 0 }, new[] { 9, 1, 2, 2 }, new[] { 1, 9, 0, 1 }, new[] { 1, 8, 1, 3 }, new[] { 0, 1, 9, 2 }, new[] { 2, 0, 3, 9 } };
int[] WEIGHT = { 30, 20, 20, 10, 12, 8 }; // how often each question topic is asked
bool[] TENANT_SPECIFIC = { false, false, false, false, true, true }; // answer depends on who asks
long[] SMALL = { 150, 600 }, LARGE = { 3000, 15000 }; // nano-dollars per input / output token
const int IN_TOK = 800, OUT_TOK = 150;
const int SEED = 7, QUERIES = 240, TENANTS = 2, WORDINGS = 3; // 3 fixed wordings per topic
const int FRESH_PERCENT = 40, HARD_PERCENT = 30, SMALL_SOLVES_HARD_PERCENT = 25;
// Confidence: a hard question is usually low (0..59), otherwise 70..99.
const int LOW_CONF_PERCENT = 75, LOW_CONF_RANGE = 60, HIGH_CONF_MIN = 70, HIGH_CONF_RANGE = 30;
const int PERMILLE = 1000, NANO_PER_MICRO = 1000;
int[][] WOBBLE = { new[] { 0, 0, 0, 0 }, new[] { -1, 0, 1, 0 }, new[] { 0, 1, 0, -1 } };

long CallCost(bool large) { var p = large ? LARGE : SMALL; return IN_TOK * p[0] + OUT_TOK * p[1]; }
long Dot(int[] a, int[] b) { long t = 0; for (int d = 0; d < a.Length; d++) t += (long)a[d] * b[d]; return t; }
bool SimOk(int[] a, int[] b, long thr) { long d = Dot(a, b); return d > 0 && d * d * PERMILLE * PERMILLE >= thr * thr * Dot(a, a) * Dot(b, b); }
long Permille(int[] a, int[] b) => (long)Math.Floor((double)PERMILLE * Dot(a, b) / Math.Sqrt((double)(Dot(a, a) * Dot(b, b))));

List<Q> MakeWorkload(int n)
{
    uint s = SEED;
    // Linear congruential generator (Numerical Recipes constants).
    int Rnd(int m) { s = unchecked(s * 1664525u + 1013904223u); return (int)((s >> 16) % (uint)m); }
    var work = new List<Q>();
    for (int i = 0; i < n; i++)
    {
        int tenant = Rnd(TENANTS), r = Rnd(100), intent = 0, acc = 0;
        for (int k = 0; k < WEIGHT.Length; k++) { acc += WEIGHT[k]; if (r < acc) { intent = k; break; } }
        int wording = Rnd(WORDINGS);
        bool fresh = Rnd(100) < FRESH_PERCENT; // 40% of questions use brand-new wording
        int[] noise = { Rnd(3) - 1, Rnd(3) - 1, Rnd(3) - 1, Rnd(3) - 1 };
        bool hard = Rnd(100) < HARD_PERCENT;
        bool smallOk = hard ? Rnd(100) < SMALL_SOLVES_HARD_PERCENT : true;
        int conf = hard ? (Rnd(100) < LOW_CONF_PERCENT ? Rnd(LOW_CONF_RANGE) : HIGH_CONF_MIN + Rnd(HIGH_CONF_RANGE)) : HIGH_CONF_MIN + Rnd(HIGH_CONF_RANGE);
        var vec = VEC[intent].Select((v, d) => v + (fresh ? noise[d] : WOBBLE[wording][d])).ToArray();
        work.Add(new Q(tenant, intent, fresh ? "u" + i : intent + ":" + wording, vec, smallOk, conf));
    }
    return work;
}

(long cost, int hits, int wrong) Run(List<Q> work, string cache, long thr = 950, bool isolate = true, string route = "large", int escalate = 65)
{
    var store = new List<E>();
    long cost = 0; int hits = 0, wrong = 0;
    foreach (var q in work)
    {
        E? hit = null;
        foreach (var e in store)
        {
            if (isolate && e.Tenant != q.Tenant) continue;
            bool match = cache == "exact" ? e.Key == q.Key : cache == "semantic" && SimOk(q.Vec, e.Vec, thr);
            if (match && (hit == null || Permille(q.Vec, e.Vec) > Permille(q.Vec, hit.Vec))) hit = e;
        }
        if (hit != null)
        {
            hits++;
            bool leaked = TENANT_SPECIFIC[q.Intent] && hit.Tenant != q.Tenant;
            if (leaked || hit.Intent != q.Intent || !hit.Ok) wrong++;
            continue;
        }
        bool ok = true;
        if (route == "large") cost += CallCost(true);
        else
        {
            cost += CallCost(false);
            ok = q.SmallOk;
            if (route == "cascade" && q.Conf < escalate) { cost += CallCost(true); ok = true; }
        }
        if (!ok) wrong++;
        if (cache != "none") store.Add(new E(q.Key, q.Tenant, q.Intent, q.Vec, ok));
    }
    return (cost, hits, wrong);
}

var work = MakeWorkload(QUERIES);
long baseCost = work.Count * CallCost(true);
Console.WriteLine($"one large call = {CallCost(true)} nano-dollars, one small call = {CallCost(false)}");
var configs = new (string, Func<(long cost, int hits, int wrong)>)[]
{
    ("no cache, large model", () => Run(work, "none")),
    ("exact cache", () => Run(work, "exact")),
    ("semantic 0.90", () => Run(work, "semantic", 900)),
    ("semantic 0.95", () => Run(work, "semantic", 950)),
    ("semantic 0.99", () => Run(work, "semantic", 990)),
    ("semantic 0.95 shared", () => Run(work, "semantic", 950, false)),
    ("small model only", () => Run(work, "none", route: "small")),
    ("cascade, escalate <65", () => Run(work, "none", route: "cascade")),
    ("semantic 0.98 + cascade", () => Run(work, "semantic", 980, route: "cascade")),
};
var R = new Dictionary<string, (long cost, int hits, int wrong)>();
foreach (var (label, fn) in configs)
{
    var r = fn();
    R[label] = r;
    long saved = 100 * (baseCost - r.cost) / baseCost;
    Console.WriteLine($"{label.PadRight(24)} cost={r.cost / NANO_PER_MICRO}u$ saved={saved}% hits={r.hits} wrong={r.wrong}");
}
if (R["no cache, large model"].wrong != 0) return 1;
if (!(R["semantic 0.90"].wrong > R["semantic 0.99"].wrong)) return 1;
if (!(R["semantic 0.95 shared"].wrong > R["semantic 0.95"].wrong)) return 1;
if (!(R["cascade, escalate <65"].wrong < R["small model only"].wrong)) return 1;
if (!(R["cascade, escalate <65"].cost < baseCost)) return 1;
Console.WriteLine("invariants hold");
return 0;

record Q(int Tenant, int Intent, string Key, int[] Vec, bool SmallOk, int Conf);
record E(string Key, int Tenant, int Intent, int[] Vec, bool Ok);
