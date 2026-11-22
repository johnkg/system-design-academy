// Topological sort on a build-dependency graph, counting operations (node visits + edge visits), not time.
// Three ways to order tasks so every task comes after the tasks it depends on:
//   scan  : the "obvious" loop, rescans every task each time it needs the next ready one
//   kahn  : count unfinished dependencies per task, release a task when its count reaches 0
//   dfs   : depth-first, emit a task after all of its dependencies
// Look for: scan grows with the square of n, Kahn and DFS with n + edges; a cycle is detected, never ordered;
// tasks downstream of a cycle are stuck too, so the "stuck" count is larger than the cycle itself;
// the number of levels (the critical path) limits how much extra workers can help.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    // Task labels are scrambled so that ids do not already come in dependency order.
    static int Label(int i, int n) => (i * 37 + 11) % n;

    static List<int>[] Build(int n, bool withCycle)
    {
        var deps = new List<int>[n];
        for (int i = 0; i < n; i++)
        {
            var d = new List<int>();
            if (i % 4 != 0) d.Add(Label(i - 1, n));
            for (int j = Math.Max(0, i - 8); j < i - 1; j++)
                if ((i * 7 + j * 13) % 9 == 0) d.Add(Label(j, n));
            deps[Label(i, n)] = d;
        }
        if (withCycle)
        {
            int a = 4 * (n / 8) + 1; // a depends on a+2, which depends on a+1, which depends on a: a 3-task cycle
            deps[Label(a, n)].Add(Label(a + 2, n));
        }
        return deps;
    }

    static int CountEdges(List<int>[] deps) => deps.Sum(d => d.Count);

    // 1. Scan: restart from the first task every time, pick the first unfinished task whose dependencies are all done.
    static (List<int> order, long ops) ScanSort(List<int>[] deps)
    {
        int n = deps.Length;
        long ops = 0;
        var done = new bool[n];
        var order = new List<int>();
        while (order.Count < n)
        {
            int picked = -1;
            for (int t = 0; t < n; t++)
            {
                ops++;
                if (done[t]) continue;
                bool ready = true;
                foreach (var d in deps[t])
                {
                    ops++;
                    if (!done[d]) { ready = false; break; }
                }
                if (ready) { picked = t; break; }
            }
            if (picked < 0) break; // nothing is ready: a cycle (without this guard the loop would never end)
            done[picked] = true;
            order.Add(picked);
        }
        return (order, ops);
    }

    // 2. Kahn: indegree = number of unfinished dependencies; a queue holds the ready tasks.
    static (List<int> order, long ops) KahnSort(List<int>[] deps)
    {
        int n = deps.Length;
        long ops = 0;
        var dependents = new List<int>[n];
        for (int t = 0; t < n; t++) dependents[t] = new List<int>();
        var indeg = new int[n];
        for (int t = 0; t < n; t++)
            foreach (var d in deps[t])
            {
                ops++;
                dependents[d].Add(t);
                indeg[t]++;
            }
        var queue = new List<int>();
        for (int t = 0; t < n; t++)
        {
            ops++;
            if (indeg[t] == 0) queue.Add(t);
        }
        int head = 0;
        var order = new List<int>();
        while (head < queue.Count)
        {
            int t = queue[head++];
            ops++;
            order.Add(t);
            foreach (var u in dependents[t])
            {
                ops++;
                indeg[u]--;
                if (indeg[u] == 0) queue.Add(u);
            }
        }
        return (order, ops);
    }

    // 3. DFS with three colours: 0 = not seen, 1 = on the current path, 2 = finished. Meeting a 1 means a cycle.
    static (List<int> order, long ops, int cycleAt) DfsSort(List<int>[] deps)
    {
        int n = deps.Length;
        var colour = new int[n];
        var order = new List<int>();
        long ops = 0;
        int cycleAt = -1;
        void Visit(int t)
        {
            ops++;
            colour[t] = 1;
            foreach (var d in deps[t])
            {
                ops++;
                if (colour[d] == 1) { if (cycleAt < 0) cycleAt = d; }
                else if (colour[d] == 0) Visit(d);
            }
            colour[t] = 2;
            order.Add(t);
        }
        for (int t = 0; t < n; t++)
        {
            ops++;
            if (colour[t] == 0) Visit(t);
        }
        return (order, ops, cycleAt);
    }

    static bool Valid(List<int> order, List<int>[] deps)
    {
        var pos = new Dictionary<int, int>();
        for (int i = 0; i < order.Count; i++) pos[order[i]] = i;
        return order.All(t => deps[t].All(d => pos[d] < pos[t]));
    }

    // Levels: level 1 = no dependencies, otherwise 1 + the highest level among dependencies (the critical path length).
    static int Levels(List<int>[] deps)
    {
        var (order, _) = KahnSort(deps);
        var lv = new int[deps.Length];
        int top = 0;
        foreach (var t in order)
        {
            int best = 0;
            foreach (var d in deps[t]) best = Math.Max(best, lv[d]);
            lv[t] = 1 + best;
            top = Math.Max(top, lv[t]);
        }
        return top;
    }

    // Makespan with w workers, every task takes 1 time unit: each step runs up to w ready tasks (lowest id first).
    static int Makespan(List<int>[] deps, int w)
    {
        int n = deps.Length;
        var dependents = new List<int>[n];
        for (int t = 0; t < n; t++) dependents[t] = new List<int>();
        var indeg = deps.Select(d => d.Count).ToArray();
        for (int t = 0; t < n; t++) foreach (var d in deps[t]) dependents[d].Add(t);
        var ready = new List<int>();
        for (int t = 0; t < n; t++) if (indeg[t] == 0) ready.Add(t);
        int steps = 0, finished = 0;
        while (finished < n)
        {
            var batch = ready.Take(w).ToList();
            ready = ready.Skip(w).ToList();
            steps++;
            finished += batch.Count;
            foreach (var t in batch)
                foreach (var u in dependents[t])
                {
                    indeg[u]--;
                    if (indeg[u] == 0) ready.Add(u);
                }
            ready.Sort();
        }
        return steps;
    }

    static string Py(bool b) => b ? "True" : "False";

    public static void Main()
    {
        Console.WriteLine("-- operations to order a build, n tasks (no cycle)");
        foreach (int n in new[] { 10, 100, 1000 })
        {
            var deps = Build(n, false);
            var s = ScanSort(deps); var k = KahnSort(deps); var d = DfsSort(deps);
            bool ok = Valid(s.order, deps) && Valid(k.order, deps) && Valid(d.order, deps) && s.order.Count == n;
            Console.WriteLine($"  n={n}: edges {CountEdges(deps)}, scan {s.ops}, kahn {k.ops}, dfs {d.ops}, all valid orders: {Py(ok)}");
        }

        Console.WriteLine("-- the same build with one 3-task cycle added");
        foreach (int n in new[] { 10, 100, 1000 })
        {
            var deps = Build(n, true);
            var s = ScanSort(deps); var k = KahnSort(deps); var d = DfsSort(deps);
            Console.WriteLine($"  n={n}: scan ordered {s.order.Count} of {n} in {s.ops} ops, kahn ordered {k.order.Count} of {n} in {k.ops} ops, " +
                $"dfs found a cycle: {Py(d.cycleAt >= 0)} in {d.ops} ops, tasks stuck behind the cycle: {n - k.order.Count}");
        }

        Console.WriteLine("-- levels and parallel build time (1 unit per task)");
        foreach (int n in new[] { 10, 100, 1000 })
        {
            var deps = Build(n, false);
            Console.WriteLine($"  n={n}: levels {Levels(deps)}, 1 worker {Makespan(deps, 1)}, 4 workers {Makespan(deps, 4)}, 16 workers {Makespan(deps, 16)}, unlimited workers {Makespan(deps, n)}");
        }
    }
}
