// A tiny continuous-profiling backend, in C#:
// samples of call stacks are interned by an FNV-1a hash, counted, folded into flame-graph paths and diffed across two releases.
using System;
using System.Collections.Generic;
using System.Linq;

// Rate control: the sampling frequency that keeps profiler overhead within a budget (in permille of one core).
// One second of one core is 1,000,000 microseconds, so a budget of b permille allows b * 1000 microseconds of sampling work per second.
static int ChooseHz(int budgetPermille, int costUs) => Math.Min(100, budgetPermille * 1000 / costUs);

static uint Fnv1a(string text) // 32-bit FNV-1a over ASCII text
{
    uint h = 2166136261;
    foreach (char ch in text) h = unchecked((h ^ ch) * 16777619u);
    return h;
}

var mix = new (string[] Frames, int Before, int After)[] {
    ("main;handle;parse_json".Split(';'), 30, 30), ("main;handle;auth;verify_token".Split(';'), 20, 20),
    ("main;handle;render;json_encode".Split(';'), 15, 40), ("main;handle;db_query;wait".Split(';'), 25, 25), ("main;gc".Split(';'), 10, 10) };

uint seed = 7;
int Next(int n) { seed = unchecked(seed * 1664525u + 1013904223u); return (int)((seed >> 16) % (uint)n); }

var stacks = new Dictionary<uint, string[]>(); // stack id -> frames (kept once, however many samples use it)
uint Intern(string[] frames)
{
    uint id = Fnv1a(string.Join(';', frames));
    if (stacks.TryGetValue(id, out var known) && !known.SequenceEqual(frames)) throw new Exception("hash collision");
    stacks.TryAdd(id, frames);
    return id;
}

(Dictionary<uint, int> Counts, int Total) Collect(bool after, int samples)
{
    var counts = new Dictionary<uint, int>();
    int total = mix.Sum(m => after ? m.After : m.Before);
    for (int i = 0; i < samples; i++)
    {
        int r = Next(total), k = 0;
        while (r >= (after ? mix[k].After : mix[k].Before)) { r -= after ? mix[k].After : mix[k].Before; k++; }
        uint id = Intern(mix[k].Frames);
        counts[id] = counts.GetValueOrDefault(id) + 1;
    }
    return (counts, samples);
}

// A flame graph is the number of samples whose stack starts with each path.
Dictionary<string, int> Flame(Dictionary<uint, int> counts)
{
    var paths = new Dictionary<string, int>();
    foreach (var (id, n) in counts)
    {
        var frames = stacks[id];
        for (int d = 1; d <= frames.Length; d++) { var p = string.Join(';', frames.Take(d)); paths[p] = paths.GetValueOrDefault(p) + n; }
    }
    return paths;
}

Console.WriteLine(string.Join("; ", new[] { 100, 250, 1000 }.Select(c => $"cost {c}us -> {ChooseHz(10, c)} Hz")));
var before = Collect(false, 20000);
var afterProfile = Collect(true, 20000);
Console.WriteLine($"samples {before.Total + afterProfile.Total}, distinct stacks {stacks.Count}");

var flame = Flame(afterProfile.Counts);
Console.WriteLine("flame graph of the new release:");
foreach (var e in flame.OrderByDescending(e => e.Value).ThenBy(e => e.Key, StringComparer.Ordinal).Take(4)) Console.WriteLine($"  {e.Value} {e.Key}");

// Diff: compare shares in parts per 10,000, so two ranges with different sample counts can be compared.
var fa = Flame(before.Counts);
var diff = flame.Select(e => (Path: e.Key, Delta: e.Value * 10000 / afterProfile.Total - fa.GetValueOrDefault(e.Key) * 10000 / before.Total))
    .OrderByDescending(e => e.Delta).ThenBy(e => e.Path, StringComparer.Ordinal).ToList();
Console.WriteLine("biggest share increases:");
foreach (var e in diff.Take(3)) Console.WriteLine($"  +{e.Delta} {e.Path}");

bool rootOk = flame["main"] == afterProfile.Total && fa["main"] == before.Total;
int worst = diff.First(e => e.Path.EndsWith("json_encode")).Delta;
Console.WriteLine($"root equals samples: {rootOk.ToString().ToLower()}; json_encode regression found: {(worst > 1000).ToString().ToLower()}");
if (!rootOk || worst <= 1000 || ChooseHz(10, 250) != 40) Environment.Exit(1);
