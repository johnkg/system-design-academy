// An error tracking ingest path in C#:
// a per-project token bucket, fingerprinting by in-app stack frames, grouping, and regression detection.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

static uint Fnv1a(string s) { uint h = 0x811c9dc5; foreach (char c in s) h = unchecked((h ^ c) * 16777619u); return h; }
static string Normalize(string m) => Regex.Replace(m, "[0-9]+", "#"); // ids and counts in a message must not split a group

// (file, function, line in release 0). A template with no frames is a message-only error.
var templates = new (string Type, string Msg, (string File, string Fn, int Line)[] Frames)[] {
    ("TypeError", "cannot read price of item", new[] { ("cart.js", "priceOf", 40), ("cart.js", "total", 12), ("view.js", "render", 88) }),
    ("RangeError", "invalid page index", new[] { ("list.js", "slice", 7), ("list.js", "paginate", 31) }),
    ("CheckoutError", "card declined for order", new[] { ("pay.js", "charge", 55), ("checkout.js", "submit", 19) }),
    ("KeyError", "missing field user", new[] { ("api.js", "parse", 23), ("api.js", "handle", 64) }),
    ("TimeoutError", "no reply after 30 s from host 10.0.0.", new (string, string, int)[0]),
};
int[] weights = { 0, 0, 0, 1, 1, 1, 2, 2, 3, 4 };

const int IdMin = 1000; // messages carry a 4-digit id
const int IdSpread = 9000;
const int VendorFns = 3; // vendor frames run0..run2
const int VendorLine = 300;
const int LineShift = 7; // app frame lines move this much every release
const int FingerprintFrames = 3; // top app frames in a fingerprint
const int Ticks = 300;
const int ReleaseTicks = 100; // a new release every 100 ticks
const int StormStart = 100; // the api retry storm: 20 events per tick for 20 ticks
const int StormTicks = 20;
const int StormEvents = 20;
const int TopGroups = 4;
uint seed = 7;
int Rnd(int n) { seed = unchecked(seed * 1664525u + 1013904223u); return (int)((seed >> 16) % (uint)n); }

Event MakeEvent(int release) {
    int idx = weights[Rnd(weights.Length)];
    if (release == 1 && idx == 2) idx = 1; // the checkout bug is fixed in release 1
    var t = templates[idx];
    int num = Rnd(IdSpread) + IdMin, vendor = Rnd(VendorFns);
    var frames = t.Frames.Select(f => new Frame(f.File, f.Fn, f.Line + release * LineShift, true)).ToList(); // lines move every release
    if (frames.Count > 0) frames.Add(new Frame("vendor.js", "run" + vendor, VendorLine + vendor, false));
    return new Event(t.Type, $"{t.Msg} {num}", frames, release);
}

uint Fingerprint(Event e) {
    var app = string.Join(">", e.Frames.Where(f => f.App).Take(FingerprintFrames).Select(f => $"{f.File}:{f.Fn}"));
    return Fnv1a($"{e.Type}|{(app != "" ? app : Normalize(e.Message))}"); // no line numbers, no vendor frames
}
uint NaiveKey(Event e) => Fnv1a($"{e.Type}|{e.Message}|" + string.Join(">", e.Frames.Select(f => $"{f.File}:{f.Fn}:{f.Line}")));

var projects = new Dictionary<string, Project> { ["web"] = new Project(), ["api"] = new Project() };
var groups = new Dictionary<string, Group>();
var naive = new HashSet<uint>();
var regressions = new List<string>();

for (int t = 0; t < Ticks; t++) {
    int release = t < ReleaseTicks ? 0 : t < 2 * ReleaseTicks ? 1 : 2;
    if (t == ReleaseTicks) foreach (var g in groups.Values) if (g.Title.StartsWith("CheckoutError")) g.Status = "resolved";
    foreach (var (name, p) in projects) {
        p.Tokens = Math.Min(Project.BucketCapacity, p.Tokens + Project.BucketRefill);
        int n = name == "api" && t >= StormStart && t < StormStart + StormTicks ? StormEvents : 1; // a retry storm in the api project
        for (int i = 0; i < n; i++) {
            var e = MakeEvent(release);
            p.Sent++;
            if (p.Tokens < 1) continue; // over the project quota: dropped
            p.Tokens--; p.Kept++;
            naive.Add(NaiveKey(e));
            var key = $"{name}:{Fingerprint(e):x8}";
            if (!groups.TryGetValue(key, out var grp)) { grp = new Group { Title = $"{e.Type}: {Normalize(e.Message)}" }; groups[key] = grp; }
            else if (grp.Status == "resolved") { grp.Status = "regressed"; regressions.Add($"{key} at t={t} in release {e.Release}"); }
            grp.Count++;
        }
    }
}

int sent = projects.Values.Sum(p => p.Sent), kept = projects.Values.Sum(p => p.Kept);
Console.WriteLine($"events sent {sent}, kept {kept}, dropped {sent - kept}");
foreach (var (name, p) in projects) Console.WriteLine($"{name}: sent {p.Sent}, kept {p.Kept}, dropped {p.Sent - p.Kept}");
Console.WriteLine($"distinct events by naive key {naive.Count}, groups by fingerprint {groups.Count}");
foreach (var kv in groups.OrderByDescending(kv => kv.Value.Count).ThenBy(kv => kv.Key, StringComparer.Ordinal).Take(TopGroups))
    Console.WriteLine($"{kv.Key} x{kv.Value.Count} [{kv.Value.Status}] {kv.Value.Title}");
Console.WriteLine($"regressions: {(regressions.Count > 0 ? string.Join("; ", regressions) : "none")}");

if (groups.Values.Sum(g => g.Count) != kept || groups.Count >= naive.Count || regressions.Count == 0) Environment.Exit(1);

record Frame(string File, string Fn, int Line, bool App);
record Event(string Type, string Message, List<Frame> Frames, int Release);
class Project // a token bucket: capacity 30, refill 3 per tick
{
    public const int BucketCapacity = 30, BucketRefill = 3;
    public int Tokens = BucketCapacity, Sent, Kept;
}
class Group { public string Title = "", Status = "open"; public int Count; }
