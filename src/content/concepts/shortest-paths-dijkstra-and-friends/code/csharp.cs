// Shortest paths, counted in steps: Dijkstra with a binary heap and with a plain array, Bellman-Ford, and A* on a grid.
// A step is one comparison inside the heap, one node looked at while scanning for the closest unsettled one, or one edge checked
// ("relaxed"). Nothing is timed.
// Look for: the heap wins on sparse graphs and can lose on dense ones; one negative edge makes Dijkstra return wrong distances
// without any error while Bellman-Ford stays right (and spots a negative cycle); a good A* heuristic expands a fraction of the
// nodes Dijkstra does, and one that overestimates saves even more but returns a longer path.
// Graphs come from fixed integer formulas. A heap entry is priority * KEY + node, so equal priorities are ordered by node.
using System;
using System.Collections.Generic;
using System.Linq;

public class Heap
{
    public List<long> A = new List<long>();
    public long C; // comparisons inside the heap

    public void Push(long key)
    {
        int i = A.Count;
        A.Add(key);
        while (i > 0)
        {
            int p = (i - 1) / 2;
            C++;
            if (key < A[p]) { A[i] = A[p]; i = p; } else break;
        }
        A[i] = key;
    }

    public long Pop()
    {
        long top = A[0], last = A[A.Count - 1];
        A.RemoveAt(A.Count - 1);
        if (A.Count > 0)
        {
            int n = A.Count, i = 0;
            while (true)
            {
                int s = 2 * i + 1;
                if (s >= n) break;
                if (s + 1 < n)
                {
                    C++;
                    if (A[s + 1] < A[s]) s++;
                }
                C++;
                if (A[s] < last) { A[i] = A[s]; i = s; } else break;
            }
            A[i] = last;
        }
        return top;
    }
}

public static class Program
{
    const long Inf = 1000000000;
    const long Key = 100000;
    const long Offset = 1000000; // added to a distance inside a heap key, so a negative distance still gives a positive key
    const long Tie = 4096; // A* priority is f * Tie - g: among equal f, the node with the larger g (closer to the goal) goes first

    static List<(int, long)>[] MakeGraph(string kind, int v)
    {
        var adj = new List<(int, long)>[v];
        for (int i = 0; i < v; i++) adj[i] = new List<(int, long)>();
        for (int i = 0; i < v; i++)
        {
            if (kind == "sparse") // three edges per node, weights 1 to 20
            {
                for (int k = 0; k < 3; k++)
                {
                    int t = (int)(((long)i * (2 * k + 3) * 7919 + (long)k * 104729 + 13) % v);
                    if (t == i) t = (t + 1) % v;
                    adj[i].Add((t, 1 + (i * 31 + k * 17 + t * 7) % 20));
                }
            }
            else if (kind == "dense") // each node points at half of the others
            {
                for (int k = 0; k < v / 2; k++)
                {
                    int t = (i + 1 + 2 * k + i % 2) % v;
                    if (t != i) adj[i].Add((t, 1 + (i * 31 + t * 17) % 20));
                }
            }
            else if (kind == "adversarial") // every edge improves a distance when it is relaxed, so the heap gets a push for each
            {
                for (int t = i + 1; t < v; t++) adj[i].Add((t, t == i + 1 ? 1 : 3 * (v - i) + (t - i)));
            }
            else if (kind == "backward") // a chain whose edges point against the order Bellman-Ford sweeps the nodes in: from the last node, one hop per round
            {
                if (i > 0) adj[i].Add((i - 1, 1));
            }
            else // "negative": a layered graph, edges only forward, weights -4 to 10: no cycles, so no negative cycle
            {
                for (int t = i + 1; t < Math.Min(v, i + 4); t++) adj[i].Add((t, (i * 37 + t * 11) % 15 - 4));
            }
        }
        return adj;
    }

    static (long[], long) DijkstraArray(List<(int, long)>[] adj, int src)
    {
        int v = adj.Length;
        var dist = Enumerable.Repeat(Inf, v).ToArray();
        var done = new bool[v];
        dist[src] = 0;
        long steps = 0;
        while (true)
        {
            int best = -1;
            for (int u = 0; u < v; u++) // scan every node for the closest one not settled yet
            {
                steps++;
                if (!done[u] && dist[u] < Inf && (best < 0 || dist[u] < dist[best])) best = u;
            }
            if (best < 0) break;
            done[best] = true;
            foreach (var (t, w) in adj[best])
            {
                steps++;
                if (dist[best] + w < dist[t]) dist[t] = dist[best] + w;
            }
        }
        return (dist, steps);
    }

    static (long[], long, long) DijkstraHeap(List<(int, long)>[] adj, int src)
    {
        int v = adj.Length;
        var dist = Enumerable.Repeat(Inf, v).ToArray();
        var done = new bool[v];
        dist[src] = 0;
        var h = new Heap();
        long edges = 0, pushes = 1;
        h.Push(Offset * Key + src);
        while (h.A.Count > 0)
        {
            int u = (int)(h.Pop() % Key);
            if (done[u]) continue; // a stale entry: the node was already settled with a smaller distance
            done[u] = true;
            foreach (var (t, w) in adj[u])
            {
                edges++;
                if (dist[u] + w < dist[t]) { dist[t] = dist[u] + w; h.Push((dist[t] + Offset) * Key + t); pushes++; }
            }
        }
        return (dist, h.C + edges, pushes);
    }

    static (long[], long, int, bool) BellmanFord(List<(int, long)>[] adj, int src)
    {
        int v = adj.Length;
        var dist = Enumerable.Repeat(Inf, v).ToArray();
        dist[src] = 0;
        long relax = 0;
        int rounds = 0;
        for (int r = 0; r < v; r++)
        {
            bool changed = false;
            rounds++;
            for (int u = 0; u < v; u++)
            {
                if (dist[u] == Inf) continue;
                foreach (var (t, w) in adj[u])
                {
                    relax++;
                    if (dist[u] + w < dist[t]) { dist[t] = dist[u] + w; changed = true; }
                }
            }
            if (!changed) return (dist, relax, rounds, false);
        }
        return (dist, relax, rounds, true); // still improving after v rounds: a negative cycle is reachable
    }

    static int EdgeCount(List<(int, long)>[] adj) => adj.Sum(x => x.Count);

    // a few blocked cells, start and goal always open
    static bool GridOpen(int w, int x, int y)
    {
        if ((x == 0 && y == 0) || (x == w - 1 && y == w - 1)) return true;
        return (x * 31 + y * 17) % 11 != 0;
    }

    // Moves cost 1. The heuristic is factor * (Manhattan distance to the goal): 0 is plain Dijkstra, 1 never overestimates, 3 does.
    static (int, long) AStar(int w, int factor)
    {
        int n = w * w, goal = n - 1;
        var g = Enumerable.Repeat(Inf, n).ToArray();
        var closed = new bool[n];
        g[0] = 0;
        var h = new Heap();
        int expanded = 0;
        h.Push((long)factor * (2 * (w - 1)) * Tie * Key);
        while (h.A.Count > 0)
        {
            int u = (int)(h.Pop() % Key);
            if (closed[u]) continue;
            closed[u] = true;
            expanded++;
            if (u == goal) return (expanded, g[u]);
            int x = u % w, y = u / w;
            foreach (var (nx, ny) in new[] { (x + 1, y), (x, y + 1), (x - 1, y), (x, y - 1) })
            {
                if (nx >= 0 && nx < w && ny >= 0 && ny < w && GridOpen(w, nx, ny))
                {
                    int t = ny * w + nx;
                    if (g[u] + 1 < g[t])
                    {
                        g[t] = g[u] + 1;
                        h.Push(((g[t] + (long)factor * ((w - 1 - nx) + (w - 1 - ny))) * Tie - g[t]) * Key + t);
                    }
                }
            }
        }
        return (expanded, -1);
    }

    public static void Main()
    {
        Console.WriteLine("-- Dijkstra from node 0: heap against array (steps)");
        foreach (var kind in new[] { "sparse", "dense", "adversarial" })
            foreach (int v in new[] { 100, 1000 })
            {
                var adj = MakeGraph(kind, v);
                var (da, sa) = DijkstraArray(adj, 0);
                var (dh, sh, pushes) = DijkstraHeap(adj, 0);
                if (!da.SequenceEqual(dh)) throw new Exception("the two implementations disagree");
                Console.WriteLine($"{kind} V={v} E={EdgeCount(adj)}: array {sa}, heap {sh} ({pushes} pushes)");
            }

        Console.WriteLine("-- negative edge weights: Dijkstra (settle each node once) against Bellman-Ford");
        foreach (int v in new[] { 100, 1000 })
        {
            var adj = MakeGraph("negative", v);
            var (bf, relax, rounds, _) = BellmanFord(adj, 0);
            var (dj, steps, _) = DijkstraHeap(adj, 0);
            int wrong = 0;
            long worst = 0;
            for (int i = 0; i < v; i++) { if (bf[i] != dj[i]) wrong++; worst = Math.Max(worst, dj[i] - bf[i]); }
            Console.WriteLine($"V={v} E={EdgeCount(adj)}: Bellman-Ford {relax} edge checks in {rounds} rounds; Dijkstra {steps} steps and wrong for {wrong} of {v} nodes (too long by up to {worst})");
        }

        // The smallest example: A -> B costs 3, A -> C costs 5, C -> B costs -4, B -> D costs 1. The best way to B is through C and costs 1.
        var triangle = new List<(int, long)>[]
        {
            new List<(int, long)> { (1, 3), (2, 5) }, new List<(int, long)> { (3, 1) }, new List<(int, long)> { (1, -4) }, new List<(int, long)>(),
        };
        var dt = DijkstraHeap(triangle, 0).Item1;
        var bt = BellmanFord(triangle, 0).Item1;
        Console.WriteLine($"four nodes, A->B 3, A->C 5, C->B -4, B->D 1: Dijkstra says B costs {dt[1]} and D costs {dt[3]}; Bellman-Ford says B costs {bt[1]} and D costs {bt[3]}");

        // 0 -> 1 costs 2, 1 -> 2 costs -3, 2 -> 1 costs 1: going round 1 -> 2 -> 1 costs -2 each time.
        var cycle = new List<(int, long)>[]
        {
            new List<(int, long)> { (1, 2) }, new List<(int, long)> { (2, -3) }, new List<(int, long)> { (1, 1) },
        };
        var (_, crelax, crounds, cyc) = BellmanFord(cycle, 0);
        Console.WriteLine($"negative cycle: Bellman-Ford still improving after {crounds} rounds ({crelax} edge checks), so it reports a cycle: {cyc.ToString().ToLower()}");

        Console.WriteLine("-- Bellman-Ford against Dijkstra with a heap, all weights positive (steps)");
        foreach (int v in new[] { 100, 1000 })
        {
            var adj = MakeGraph("sparse", v);
            var (_, relax, rounds, _) = BellmanFord(adj, 0);
            var (_, sh, _) = DijkstraHeap(adj, 0);
            Console.WriteLine($"sparse V={v}: Bellman-Ford {relax} edge checks in {rounds} rounds, Dijkstra {sh}");
        }
        foreach (int v in new[] { 100, 1000 })
        {
            var adj = MakeGraph("backward", v);
            var (_, relax, rounds, _) = BellmanFord(adj, v - 1);
            var (_, sh, _) = DijkstraHeap(adj, v - 1);
            Console.WriteLine($"backward chain V={v}: Bellman-Ford {relax} edge checks in {rounds} rounds, Dijkstra {sh}");
        }

        Console.WriteLine("-- A* on a grid with some blocked cells: nodes expanded before reaching the far corner");
        foreach (int w in new[] { 20, 50, 100 })
        {
            var row = new List<string>();
            foreach (var (name, factor) in new[] { ("no heuristic (Dijkstra)", 0), ("Manhattan distance", 1), ("3 x Manhattan distance", 3) })
            {
                var (expanded, cost) = AStar(w, factor);
                row.Add($"{name}: {expanded} expanded, path cost {cost}");
            }
            Console.WriteLine($"{w}x{w} grid ({w * w} cells): " + string.Join("; ", row));
        }
    }
}
