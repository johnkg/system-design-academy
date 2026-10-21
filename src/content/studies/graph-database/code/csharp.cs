// A property graph with adjacency lists, in C#:
// every node holds a direct list of its neighbours, so a hop is a list read. Supernodes are not expanded, and a hash splits nodes over shards.
#nullable disable
using System;
using System.Collections.Generic;
using System.Linq;

public record Walk(List<int> Levels, HashSet<int> Seen, int Examined, int Cross);

public class Graph
{
    public const int Shards = 4;
    // Knuth's multiplicative hash (2654435761 is about 2^32 / golden ratio).
    public static int ShardOf(int id) => (int)(((ulong)id * 2654435761UL & 0xFFFFFFFFUL) >> 16) % Shards; // the high bits of the product are well mixed

    public readonly List<int>[] Adj;
    public readonly List<(int, int)> Edges = new();
    public Graph(int n) { Adj = Enumerable.Range(0, n).Select(_ => new List<int>()).ToArray(); }

    public void AddEdge(int a, int b) { Adj[a].Add(b); Adj[b].Add(a); Edges.Add((a, b)); } // a friendship is stored on both ends
    public int Degree(int id) => Adj[id].Count;

    // Breadth-first walk of k hops. A node with more than `cap` neighbours is reached but not expanded.
    public Walk Run(int start, int k, int cap)
    {
        var seen = new HashSet<int> { start };
        var frontier = new List<int> { start };
        int examined = 0, cross = 0;
        var levels = new List<int>();
        for (int hop = 0; hop < k; hop++)
        {
            var next = new List<int>();
            foreach (int u in frontier)
            {
                if (Degree(u) > cap) continue;             // do not open a supernode
                foreach (int v in Adj[u])
                {
                    examined++;
                    if (ShardOf(u) != ShardOf(v)) cross++; // this step would be a network call
                    if (seen.Add(v)) next.Add(v);
                }
            }
            levels.Add(next.Count);
            frontier = next;
        }
        return new Walk(levels, seen, examined, cross);
    }
}

public static class Program
{
    const int Seed = 7, FriendsPerUser = 3, Start = 5, Hops = 3, DegreeCap = 50;
    static long seed = Seed;
    // Linear congruential generator (Numerical Recipes constants), high 16 bits.
    static int Random(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)(seed / 65536 % n); }

    static void Show(string label, Walk r) =>
        Console.WriteLine($"{label}: new nodes per hop [{string.Join(", ", r.Levels)}], reached {r.Seen.Count}, edges examined {r.Examined}, cross-shard {r.Cross}");

    public static int Main()
    {
        const int N = 400;
        var graph = new Graph(N);
        for (int i = 1; i < N; i++) graph.AddEdge(0, i);   // node 0 is a celebrity that everyone follows
        for (int i = 1; i < N; i++) for (int j = 0; j < FriendsPerUser; j++) { int b = 1 + Random(N - 1); if (b != i) graph.AddEdge(i, b); }

        int maxDegree = graph.Adj.Max(a => a.Count);
        int median = graph.Adj.Select(a => a.Count).OrderBy(x => x).ElementAt(N >> 1);
        Console.WriteLine($"nodes {N}, edges {graph.Edges.Count}, supernode degree {graph.Degree(0)}, median degree {median}");

        var full = graph.Run(Start, Hops, int.MaxValue);
        var capped = graph.Run(Start, Hops, DegreeCap);
        Show("3 hops, expand everything ", full);
        Show("3 hops, skip nodes over 50", capped);

        // Check the walk against the slow way: scan the whole edge list once per hop.
        var reach = new HashSet<int> { Start };
        for (int hop = 0; hop < Hops; hop++)
        {
            var grown = new HashSet<int>(reach);
            foreach (var (a, b) in graph.Edges) { if (reach.Contains(a)) grown.Add(b); if (reach.Contains(b)) grown.Add(a); }
            reach = grown;
        }
        bool same = reach.SetEquals(full.Seen);
        int saved = 100 * (full.Examined - capped.Examined) / full.Examined;
        Console.WriteLine($"matches the edge-list scan: {(same ? "true" : "false")}; the cap saves {saved}% of the edge reads; max degree {maxDegree}");
        return !same || capped.Examined >= full.Examined || maxDegree != graph.Degree(0) ? 1 : 0;
    }
}
