// A tiny pipeline orchestrator in C#: a DAG of tasks run once per day (the data interval),
// a sensor that waits for a file, retries with backoff, and a backfill that is safe to repeat.
using System;
using System.Collections.Generic;
using System.Linq;

static class P
{
    public static uint Hash(string s) { uint h = 2166136261; foreach (char c in s) { h ^= c; h = unchecked(h * 16777619u); } return h; }

    // Tasks in dependency order: (name, upstream tasks).
    public static readonly (string Name, string[] Deps)[] Tasks = {
        ("wait_file", new string[0]), ("extract", new[] { "wait_file" }), ("clean", new[] { "extract" }),
        ("by_region", new[] { "clean" }), ("by_product", new[] { "clean" }), ("report", new[] { "by_region", "by_product" }) };
    public const int Poke = 10, Timeout = 30, MaxAttempts = 3; // sensor checks every 10 minutes and gives up after 30
    public static bool Flaky(string task, int day) => Hash($"{task}:{day}") % 5 == 0; // fails its first two attempts, then works

    public class Orchestrator
    {
        public Dictionary<string, string> State = new();
        public Dictionary<string, uint> Output = new();
        public int Ran, Skipped, Failed, Blocked, Retries, Backoff, Pokes;

        string RunTask(string task, string[] deps, int day, Dictionary<int, int> arrival)
        {
            string key = $"{task}/{day}";
            if (task == "wait_file") // sensor: poke until the file has landed or the timeout passes
            {
                bool late = arrival[day] > Timeout;
                Pokes += late ? Timeout / Poke : Math.Max(1, (arrival[day] + Poke - 1) / Poke);
                if (late) return "timeout";
                Output[key] = Hash($"file:{day}");
                return "success";
            }
            for (int attempt = 1; attempt <= MaxAttempts; attempt++)
            {
                if (Flaky(task, day) && attempt < MaxAttempts) { Retries++; Backoff += 30 * (1 << (attempt - 1)); continue; }
                string inputs = string.Join(",", deps.Select(d => Output[$"{d}/{day}"]));
                Output[key] = Hash($"{task}:{day}:{inputs}"); // overwrite the partition, never append
                return "success";
            }
            return "failed";
        }

        public string Backfill(int[] days, Dictionary<int, int> arrival)
        {
            Ran = Skipped = Failed = Blocked = Retries = Backoff = Pokes = 0;
            foreach (int day in days)
                foreach (var (task, deps) in Tasks)
                {
                    string key = $"{task}/{day}";
                    if (State.GetValueOrDefault(key) == "success") { Skipped++; continue; }
                    if (deps.Any(d => State.GetValueOrDefault($"{d}/{day}") != "success")) { State[key] = "upstream_failed"; Blocked++; continue; }
                    string result = RunTask(task, deps, day, arrival);
                    State[key] = result; Ran++;
                    if (result != "success") Failed++;
                }
            return $"ran {Ran}, skipped {Skipped}, failed {Failed}, blocked {Blocked}, retries {Retries}, backoff {Backoff}s, pokes {Pokes}";
        }

        public uint Checksum()
        {
            uint acc = 0;
            foreach (var k in Output.Keys.OrderBy(k => k, StringComparer.Ordinal)) acc = Hash($"{acc}:{k}={Output[k]}");
            return acc;
        }
    }

    static int Main()
    {
        int[] days = { 1, 2, 3, 4, 5, 6 };
        var arrival = new Dictionary<int, int> { [1] = 5, [2] = 12, [3] = 28, [4] = 45, [5] = 8, [6] = 20 }; // minutes after midnight that each file lands
        var run = new Orchestrator();
        Console.WriteLine("backfill 1: " + run.Backfill(days, arrival));
        Console.WriteLine($"day 4 is {run.State["wait_file/4"]} and report/4 is {run.State["report/4"]}");
        arrival[4] = 3; // the late file has now landed
        Console.WriteLine("backfill 2: " + run.Backfill(days, arrival));
        uint sum = run.Checksum();
        Console.WriteLine("backfill 3: " + run.Backfill(days, arrival));
        foreach (var t in new[] { "clean", "by_region", "by_product", "report" }) run.State.Remove($"{t}/2"); // clear day 2 from clean onward
        Console.WriteLine("rerun day 2: " + run.Backfill(days, arrival));
        Console.WriteLine($"checksum {sum}, unchanged after reruns: {(run.Checksum() == sum).ToString().ToLower()}");

        var fresh = new Orchestrator();
        fresh.Backfill(days, arrival);
        Console.WriteLine($"a fresh run from scratch gives the same checksum: {(fresh.Checksum() == sum).ToString().ToLower()}");
        return run.Checksum() != sum || fresh.Checksum() != sum || run.Ran != 4 || fresh.Failed != 0 ? 1 : 0;
    }
}
