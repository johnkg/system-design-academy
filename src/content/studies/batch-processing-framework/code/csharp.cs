// A tiny MapReduce job in C#: map tasks with a combiner, a hash-partitioned shuffle,
// reduce tasks, recovery of lost output by re-running only the tasks it came from, and a speculative backup for a straggler.
using System;
using System.Collections.Generic;
using System.Linq;

const int Splits = 8, Reducers = 4, PerSplit = 500, Vocab = 40;
const int TopN = 3; // words in the top list
const int LostReducer = 2; // failure demo: the reducer whose output is lost
const int BackupNum = 3; // start a backup copy after 3/2 of the median task time
const int BackupDen = 2;
uint seed = 7;
int Next() { unchecked { seed = seed * 1664525u + 1013904223u; } return (int)(seed >> 16); }

// Input splits: words with a skew, so a few words are very common.
var splits = Enumerable.Range(0, Splits).Select(_ => Enumerable.Range(0, PerSplit).Select(__ =>
{
    int a = Next() % Vocab, b = Next() % Vocab;
    return "w" + (a * b / Vocab).ToString("D2");
}).ToList()).ToList();

uint Fnv(string s) { uint h = 2166136261; unchecked { foreach (char c in s) h = (h ^ c) * 16777619u; } return h; }
int mapRuns = 0, reduceRuns = 0;

// A map task reads one split and writes one bucket per reducer. The combiner adds up equal words before they leave the mapper.
Dictionary<string, int>[] MapTask(int i)
{
    mapRuns++;
    var buckets = Enumerable.Range(0, Reducers).Select(_ => new Dictionary<string, int>()).ToArray();
    foreach (var w in splits[i]) { var b = buckets[Fnv(w) % Reducers]; b[w] = b.GetValueOrDefault(w) + 1; }
    return buckets;
}
// A reduce task fetches its own bucket from every map output and merges them.
Dictionary<string, int> ReduceTask(int p, Dictionary<string, int>[][] mapOut)
{
    reduceRuns++;
    var total = new Dictionary<string, int>();
    foreach (var o in mapOut) foreach (var (w, n) in o[p]) total[w] = total.GetValueOrDefault(w) + n;
    return total;
}
string Show(Dictionary<string, int> m) => string.Join(",", m.OrderBy(kv => kv.Key, StringComparer.Ordinal).Select(kv => $"{kv.Key}:{kv.Value}"));

var mapOut = Enumerable.Range(0, Splits).Select(MapTask).ToArray();
var result = Enumerable.Range(0, Reducers).Select(p => ReduceTask(p, mapOut)).ToArray();

int shuffled = mapOut.SelectMany(o => o).Sum(b => b.Count);
var load = result.Select(r => r.Values.Sum()).ToArray();
var merged = new Dictionary<string, int>();
foreach (var r in result) foreach (var kv in r) merged[kv.Key] = kv.Value;
var top = merged.OrderByDescending(kv => kv.Value).ThenBy(kv => kv.Key, StringComparer.Ordinal).Take(TopN);
Console.WriteLine($"input: {Splits} splits x {PerSplit} words, {Reducers} reducers");
Console.WriteLine($"shuffle records: {Splits * PerSplit} without a combiner, {shuffled} with it");
Console.WriteLine($"words per reducer: {string.Join(", ", load)}; distinct words: {merged.Count}");
Console.WriteLine($"top 3: {string.Join(", ", top.Select(kv => $"{kv.Key}={kv.Value}"))}");

// Failure: reducer 2's output is lost, and so are the map outputs held by the machine that ran splits 3 and 5.
int[] lostSplits = { 3, 5 }; // map outputs lost with the failed machine
string before = Show(result[LostReducer]);
mapRuns = 0; reduceRuns = 0;
for (int i = 0; i < Splits; i++) if (lostSplits.Contains(i)) mapOut[i] = MapTask(i); // recompute the lost inputs from the source splits
result[LostReducer] = ReduceTask(LostReducer, mapOut);                                            // then only the lost partition
bool same = Show(result[LostReducer]) == before;
Console.WriteLine($"recovery: re-ran {mapRuns} map tasks and {reduceRuns} reduce task instead of {Splits} and {Reducers}; identical: {(same ? "true" : "false")}");

// Straggler: nine map tasks run at once, and one machine is slow. After 1.5 x the median time, start a backup copy elsewhere.
int[] times = { 10, 10, 11, 10, 9, 10, 45, 10, 12 };
int median = times.OrderBy(t => t).ToArray()[times.Length / 2];
int limit = median * BackupNum / BackupDen;
int slowest = times.Max();
int withBackup = times.Max(t => t > limit ? Math.Min(t, limit + median) : t);
Console.WriteLine($"straggler: job takes {slowest} without a backup, {withBackup} with a backup started at {limit}");

var direct = new Dictionary<string, int>();
foreach (var s in splits) foreach (var w in s) direct[w] = direct.GetValueOrDefault(w) + 1;
if (Show(direct) != Show(merged) || load.Sum() != Splits * PerSplit || !same || withBackup >= slowest) Environment.Exit(1);
