// A miniature of MapReduce from Google's 2004 paper, in C# (a teaching model, not Google's code):
// a word count with M map tasks and R reduce tasks, a combiner, a partitioning function, a master that re-runs finished map
// tasks when their worker dies (their output was on that worker's local disk), and a backup task for a straggler whose
// duplicate output is ignored. Everything is deterministic.

using System;
using System.Collections.Generic;
using System.Linq;

var splits = new[] { "the quick brown fox", "the lazy dog", "the fox and the dog", "quick quick brown" };
const int R = 2;
var workers = new[] { "W1", "W2", "W3" };
var local = workers.ToDictionary(w => w, w => new Dictionary<int, List<(string Word, int N)>[]>()); // map output lives on the worker's local disk
var alive = new HashSet<string>(workers);
var where = new Dictionary<int, string>(); // map task -> worker that holds its output
int Partition(string word) => word.Sum(ch => (int)ch) % R; // like hash(key) mod R

void RunMap(int task, string worker)
{
    var counts = new Dictionary<string, int>(); // combiner: add up repeated words inside the map task before anything is sent
    foreach (var word in splits[task].Split(' ')) counts[word] = counts.GetValueOrDefault(word) + 1;
    var buckets = Enumerable.Range(0, R).Select(_ => new List<(string Word, int N)>()).ToArray();
    foreach (var (word, n) in counts) buckets[Partition(word)].Add((word, n));
    local[worker][task] = buckets;
    where[task] = worker;
    Console.WriteLine($"map {task} on {worker}: {splits[task].Split(' ').Length} pairs became {counts.Count} after the combiner");
}

for (int task = 0; task < splits.Length; task++) RunMap(task, workers[task % workers.Length]);

alive.Remove("W2");
Console.WriteLine("W2 stops answering pings and is marked failed");
foreach (var (task, worker) in where.ToList())
{
    if (!alive.Contains(worker))
    {
        where.Remove(task);
        Console.WriteLine($"map {task} was done on {worker} but its output is on a dead disk: back to idle");
        RunMap(task, "W3");
        Console.WriteLine($"map {task} re-executed on W3");
    }
}

var outputs = new Dictionary<string, string>(); // output file name -> worker that finished first
void RunReduce(int r, string worker)
{
    var totals = new Dictionary<string, int>();
    for (int task = 0; task < splits.Length; task++)
        foreach (var (word, n) in local[where[task]][task][r]) totals[word] = totals.GetValueOrDefault(word) + n;
    string line = string.Join(" ", totals.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => $"{p.Key}={p.Value}"));
    string file = $"part-{r}";
    if (outputs.ContainsKey(file))
    {
        Console.WriteLine($"reduce {r} also finished on {worker}, but {file} already exists from {outputs[file]}: ignored");
        return;
    }
    outputs[file] = worker;
    Console.WriteLine($"reduce {r} finished on {worker}: {file} = {line}");
}

RunReduce(0, "W1");
Console.WriteLine("reduce 1 on W3 is a straggler, so the master starts a backup copy on W1");
RunReduce(1, "W1");
RunReduce(1, "W3");
Console.WriteLine("output files: " + string.Join(", ", outputs.Select(p => $"{p.Key} (from {p.Value})")));
