// A miniature MapReduce: map, optional combiner, hash-partitioned shuffle, sort, reduce. Then a hot-key skew demo with salting.
using System;
using System.Collections.Generic;
using System.Linq;

static uint Fnv1a(string s) // 32-bit FNV-1a: stable across languages, unlike built-in hash codes
{
    uint h = 2166136261;
    foreach (char c in s) h = unchecked((h ^ c) * 16777619u);
    return h;
}

static List<(string, int)> MapPhase(string[] split, bool useCombiner)
{
    var output = split.SelectMany(line => line.Split(' ')).Select(w => (w, 1)).ToList(); // map: emit (word, 1)
    if (!useCombiner) return output;
    var local = new Dictionary<string, int>(); // combiner: pre-sum inside the mapper, before the network
    foreach (var (w, n) in output) local[w] = local.GetValueOrDefault(w) + n;
    return local.Select(kv => (kv.Key, kv.Value)).ToList();
}

static List<(string, int)>[] Shuffle(List<List<(string, int)>> mapOutputs, int reducers)
{
    var buckets = Enumerable.Range(0, reducers).Select(_ => new List<(string, int)>()).ToArray();
    foreach (var records in mapOutputs)
        foreach (var (k, v) in records) buckets[(int)(Fnv1a(k) % (uint)reducers)].Add((k, v));
    return buckets;
}

static SortedDictionary<string, int> ReducePhase(List<(string, int)> bucket)
{
    var result = new SortedDictionary<string, int>(StringComparer.Ordinal); // reducers see keys in sorted order
    foreach (var (k, v) in bucket) result[k] = result.GetValueOrDefault(k) + v;
    return result;
}

string[][] splits = {
    new[] { "the cat sat on the mat", "the dog sat on the log" },
    new[] { "the cat saw the dog", "the dog saw the cat" },
    new[] { "a cat and a dog sat", "on the mat and the log" },
};
const int R = 3;
var totals = new Dictionary<bool, string>();
foreach (bool combiner in new[] { false, true })
{
    var outputs = splits.Select(s => MapPhase(s, combiner)).ToList();
    var buckets = Shuffle(outputs, R);
    var merged = new SortedDictionary<string, int>(StringComparer.Ordinal);
    foreach (var b in buckets) foreach (var kv in ReducePhase(b)) merged[kv.Key] = kv.Value;
    Console.WriteLine($"combiner={(combiner ? "true" : "false")}: shuffled {buckets.Sum(b => b.Count)} records, per reducer [{string.Join(", ", buckets.Select(b => b.Count))}]");
    totals[combiner] = string.Join(" ", merged.Select(kv => $"{kv.Key}={kv.Value}"));
}
Console.WriteLine(totals[true]);
if (totals[true] != totals[false]) throw new Exception("combiner changed the answer");

// Skew: 2000 events, half of them for one hot key. One reducer gets the hot key and becomes the straggler.
const int EVENTS = 2000, COLD_USERS = 50, SEED = 12345;
const int SALT_BUCKETS = R * 2; // the hot key is split over this many salted keys
uint seed = SEED;
// Linear congruential generator (Numerical Recipes constants).
int Rand(int n) { seed = unchecked(seed * 1664525u + 1013904223u); return (int)((seed >> 8) % (uint)n); }
var events = Enumerable.Range(0, EVENTS).Select(i => i % 2 == 0 ? "hot" : "user" + Rand(COLD_USERS)).ToList();
string Ratio(int[] l) { int h = l.Max() * R * 100 / EVENTS; return $"{h / 100}.{(h % 100):00}"; }
int[] Load(Func<string, string> keyOf)
{
    var l = new int[R];
    foreach (var e in events) l[(int)(Fnv1a(keyOf(e)) % (uint)R)]++;
    return l;
}
var plain = Load(e => e);
var salted = Load(e => e == "hot" ? "hot#" + Rand(SALT_BUCKETS) : e); // stage 1: spread the hot key over 6 salted keys
Console.WriteLine($"plain  load [{string.Join(", ", plain)}] slowest/average = {Ratio(plain)}");
Console.WriteLine($"salted load [{string.Join(", ", salted)}] slowest/average = {Ratio(salted)}");
Console.WriteLine("stage 2 merges the 6 partial counts of 'hot' into one number (tiny shuffle)");
if (plain.Sum() != EVENTS || salted.Sum() != EVENTS) throw new Exception("records lost");
