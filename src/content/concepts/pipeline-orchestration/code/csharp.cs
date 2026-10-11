// A tiny orchestrator: a DAG of tasks per date, retries with backoff, upstream_failed, and clear-and-rerun.
// Each task writes 10 rows for its date. A failing attempt dies after writing 5 rows.
using System;
using System.Collections.Generic;
using System.Linq;

string[] names = { "extract", "clean", "aggregate", "publish" };
int[][] ups = { new int[0], new[] { 0 }, new[] { 1 }, new[] { 2 } };
string[] dates = { "03-01", "03-02", "03-03" };
const int FULL = 10, PARTIAL = 5;
// failing attempts per [date][task]: 03-02 clean fails once (transient), 03-03 aggregate fails every time (hard)
int[][] FAILS = { new[] { 0, 0, 0, 0 }, new[] { 0, 1, 0, 0 }, new[] { 0, 0, 99, 0 } };

void RunPipeline(int retries, bool idempotent, HashSet<string>? only, int[][] failsLeft, string[][] state, Dictionary<string, int> rows, List<string> log)
{
    // only: set of "d:t" keys to run; null means everything. Tasks run in topological order (the array order).
    for (int d = 0; d < dates.Length; d++)
    {
        for (int t = 0; t < names.Length; t++)
        {
            string key = d + ":" + t;
            if (only != null && !only.Contains(key)) continue;
            if (ups[t].Any(u => state[d][u] != "success"))
            {
                state[d][t] = "upstream_failed";
                log.Add(dates[d] + " " + names[t] + " upstream_failed");
                continue;
            }
            for (int attempt = 1; ; attempt++)
            {
                bool fail = failsLeft[d][t] > 0;
                if (fail) failsLeft[d][t]--;
                int n = fail ? PARTIAL : FULL;
                rows[key] = idempotent ? n : (rows.TryGetValue(key, out var old) ? old : 0) + n; // overwrite the partition, or append
                if (!fail) { state[d][t] = "success"; log.Add(dates[d] + " " + names[t] + " success attempts=" + attempt); break; }
                if (attempt > retries) { state[d][t] = "failed"; log.Add(dates[d] + " " + names[t] + " failed attempts=" + attempt); break; }
                log.Add(dates[d] + " " + names[t] + " retry in " + (1 << attempt) + "m");
            }
        }
    }
}

(int total, int expected, string[][] state) Scenario(string label, int retries, bool idempotent, bool clearAndRerun)
{
    var state = dates.Select(_ => names.Select(_ => "queued").ToArray()).ToArray();
    var rows = new Dictionary<string, int>();
    var log = new List<string>();
    var failsLeft = FAILS.Select(r => r.ToArray()).ToArray();
    RunPipeline(retries, idempotent, null, failsLeft, state, rows, log);
    if (clearAndRerun)
    {
        // the operator fixed the cause: clear every failed or upstream_failed instance and run them again
        var only = new HashSet<string>();
        for (int d = 0; d < dates.Length; d++)
            for (int t = 0; t < names.Length; t++)
                if (state[d][t] != "success") only.Add(d + ":" + t);
        foreach (var k in only)
        {
            var p = k.Split(':').Select(int.Parse).ToArray();
            state[p[0]][p[1]] = "queued";
            failsLeft[p[0]][p[1]] = 0;
        }
        RunPipeline(retries, idempotent, only, failsLeft, state, rows, log);
    }
    int total = rows.Values.Sum();
    int expected = dates.Length * names.Length * FULL;
    Console.WriteLine("== " + label + " ==");
    foreach (var l in log) Console.WriteLine("  " + l);
    Console.WriteLine("  rows=" + total + " expected=" + expected + " duplicates=" + Math.Max(0, total - expected));
    return (total, expected, state);
}

var a = Scenario("no retries, overwrite, no operator", 0, true, false);
var b = Scenario("2 retries, overwrite, no operator", 2, true, false);
var c = Scenario("2 retries, overwrite, clear and rerun", 2, true, true);
var e = Scenario("2 retries, append, clear and rerun", 2, false, true);

if (a.state[1][1] != "failed" || a.state[1][3] != "upstream_failed") return 1;
if (b.state[1][1] != "success" || b.state[2][2] != "failed") return 1;
if (c.total != c.expected || e.total <= e.expected) return 1;
Console.WriteLine("ok");
return 0;
