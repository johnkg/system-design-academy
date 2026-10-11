// The core of a CI system in C#: a pipeline DAG, content-addressed cache keys,
// timing-based test sharding and a fair-share scheduler.
using System;
using System.Collections.Generic;
using System.Linq;

// 1. A pipeline is a DAG: each job lists the jobs it needs. Jobs in the same layer can run at the same time.
var pipeline = new List<(string Name, string[] Needs)> {
    ("lint", new string[0]), ("build", new string[0]), ("test", new[] { "build" }), ("package", new[] { "test", "lint" }) };

static List<List<string>> Layers(List<(string Name, string[] Needs)> jobs) {
    var done = new HashSet<string>(); var output = new List<List<string>>();
    while (done.Count < jobs.Count) {
        var ready = jobs.Where(j => !done.Contains(j.Name) && j.Needs.All(done.Contains)).Select(j => j.Name).ToList();
        if (ready.Count == 0) throw new Exception("the pipeline has a cycle");
        output.Add(ready); foreach (var j in ready) done.Add(j);
    }
    return output;
}

// 2. A cache key is a hash of the content that decides the result, so equal inputs give the same key and any change gives a new one.
static string Hash(string text) { // FNV-1a, 32 bits
    uint h = 0x811c9dc5;
    foreach (char ch in text) h = unchecked((h ^ ch) * 16777619u);
    return h.ToString("x8");
}
static string CacheKey(string os, string lockfile) => $"deps-{os}-{Hash(lockfile)}";

// 3. Test sharding: put the slowest test first on the least loaded shard (greedy), using the timings of earlier runs.
uint seed = 99;
int Rand(int n) { seed = unchecked(seed * 1664525u + 1013904223u); return (int)((seed >> 16) % (uint)n); }
static int[] Shard(List<(string Name, int Secs)> tests, int k) {
    var loads = new int[k];
    foreach (var t in tests.OrderBy(t => -t.Secs).ThenBy(t => t.Name, StringComparer.Ordinal))
        loads[Array.IndexOf(loads, loads.Min())] += t.Secs;
    return loads;
}

// 4. Scheduling: all jobs wait at time 0 and each takes 3 minutes. First come first served, or the team with the fewest running jobs goes next.
static Dictionary<string, int> Schedule(List<(string Team, string Id)> jobs, int runners, bool fair) {
    var free = new int[runners]; var pending = new List<(string Team, string Id)>(jobs);
    var spans = new List<(string Team, int Start, int End)>(); var start = new Dictionary<string, int>();
    while (pending.Count > 0) {
        int t = free.Min(), r = Array.IndexOf(free, t);
        int Running(string team) => spans.Count(s => s.Team == team && s.Start <= t && t < s.End);
        int pick = 0;
        if (fair) for (int i = 1; i < pending.Count; i++) if (Running(pending[i].Team) < Running(pending[pick].Team)) pick = i;
        var job = pending[pick]; pending.RemoveAt(pick);
        spans.Add((job.Team, t, t + 3)); start[job.Id] = t; free[r] = t + 3;
    }
    return start;
}

var lay = Layers(pipeline);
Console.WriteLine($"pipeline layers: {string.Join(" > ", lay.Select(l => string.Join("+", l)))}");

string lockText = "left-pad 1.3.0\nreact 18.2.0\nzod 3.22.4\n";
bool same = CacheKey("linux", lockText) == CacheKey("linux", "left-pad 1.3.0\nreact 18.2.0\nzod 3.22.4\n");
bool changed = CacheKey("linux", lockText) == CacheKey("linux", lockText.Replace("18.2.0", "18.3.1"));
Console.WriteLine($"cache key {CacheKey("linux", lockText)}; same lockfile same key: {same.ToString().ToLower()}; one version changed, same key: {changed.ToString().ToLower()}");

var tests = Enumerable.Range(0, 12).Select(i => ($"t{i + 1:00}", 10 + Rand(170))).ToList();
int total = tests.Sum(t => t.Item2), longest = tests.Max(t => t.Item2);
var loads = Shard(tests, 4);
var roundRobin = new int[4]; for (int i = 0; i < tests.Count; i++) roundRobin[i % 4] += tests[i].Item2;
Console.WriteLine($"one shard takes {total} s; 4 shards by timing: {string.Join(", ", loads)} s; 4 shards by name: {string.Join(", ", roundRobin)} s");

var jobs = Enumerable.Range(1, 8).Select(i => ("A", $"A{i}")).Concat(new[] { ("B", "B1"), ("B", "B2") }).ToList();
static int WaitB(Dictionary<string, int> s) => Math.Max(s["B1"], s["B2"]);
var fifo = Schedule(jobs, 2, false); var fairShare = Schedule(jobs, 2, true);
Console.WriteLine($"team B waits at most {WaitB(fifo)} min first come first served, and {WaitB(fairShare)} min with fair share");

bool ok = lay.Count == 3 && same && !changed
    && loads.Max() * 4 <= total + longest * 3 && loads.Sum() == total
    && WaitB(fairShare) < WaitB(fifo);
return ok ? 0 : 1;
