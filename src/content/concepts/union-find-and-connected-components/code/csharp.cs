// Union-find (disjoint sets) with and without path compression and union by rank, counting operations, not time.
// One operation = one read or write of a parent pointer (following a pointer, linking two roots, or rewriting a pointer during compression).
// Look for: the chain workload makes plain union-find quadratic (every query walks the whole chain) while
// compression or rank (or both) keep it near one step per operation; random edges are kind to everything;
// a graph traversal wins when the graph is fixed (one pass labels every component) but must be re-run after
// every new edge when edges keep arriving, which is where union-find earns its place.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const long M = 2147483647; // Park-Miller generator: small enough that a * 48271 fits in 53 bits, so all languages agree

    class Rng
    {
        long s;
        public Rng(long seed) { s = seed; }
        public long Next() { s = s * 48271 % M; return s; }
    }

    class DSU
    {
        public int[] Parent, Rank;
        public bool UseRank, UseCompress;
        public long Ops;

        public DSU(int n, bool rank, bool compress)
        {
            Parent = Enumerable.Range(0, n).ToArray();
            Rank = new int[n];
            UseRank = rank;
            UseCompress = compress;
        }

        public int Find(int x)
        {
            int r = x;
            while (Parent[r] != r) { r = Parent[r]; Ops++; }
            if (UseCompress)
            {
                while (Parent[x] != r) // second pass: point every node on the path straight at the root
                {
                    int nxt = Parent[x];
                    Parent[x] = r;
                    Ops++;
                    x = nxt;
                }
            }
            return r;
        }

        public bool Union(int a, int b)
        {
            int ra = Find(a), rb = Find(b);
            if (ra == rb) return false;
            if (UseRank && Rank[ra] > Rank[rb]) (ra, rb) = (rb, ra); // attach the shallower root under the deeper one
            Parent[ra] = rb;
            Ops++;
            if (UseRank && Rank[ra] == Rank[rb]) Rank[rb]++;
            return true;
        }

        public int Depth()
        {
            int best = 0;
            for (int i = 0; i < Parent.Length; i++)
            {
                int x = i, d = 0;
                while (Parent[x] != x) { x = Parent[x]; d++; }
                best = Math.Max(best, d);
            }
            return best;
        }
    }

    static readonly (string name, bool rank, bool comp)[] Variants =
        { ("naive", false, false), ("rank", true, false), ("compression", false, true), ("both", true, true) };

    static (List<(int, int)> edges, List<(int, int)> queries) RandomWorkload(int n, long seed = 12345)
    {
        var rng = new Rng(seed);
        var edges = new List<(int, int)>();
        var queries = new List<(int, int)>();
        for (int i = 0; i < n; i++) { int a = (int)(rng.Next() % n); int b = (int)(rng.Next() % n); edges.Add((a, b)); }
        for (int i = 0; i < n; i++) { int a = (int)(rng.Next() % n); int b = (int)(rng.Next() % n); queries.Add((a, b)); }
        return (edges, queries);
    }

    // Traversal on a fixed graph: build adjacency, then one pass labels every component; each query is a label comparison.
    static (long ops, int comps, int answers) TraversalStatic(int n, List<(int, int)> edges, List<(int, int)> queries)
    {
        long ops = 0;
        var adj = new List<int>[n];
        for (int i = 0; i < n; i++) adj[i] = new List<int>();
        foreach (var (a, b) in edges) { adj[a].Add(b); adj[b].Add(a); ops++; }
        var label = new int[n];
        Array.Fill(label, -1);
        int comps = 0;
        for (int s = 0; s < n; s++)
        {
            ops++;
            if (label[s] >= 0) continue;
            label[s] = comps;
            var stack = new Stack<int>();
            stack.Push(s);
            while (stack.Count > 0)
            {
                int x = stack.Pop();
                foreach (var y in adj[x])
                {
                    ops++;
                    if (label[y] < 0) { label[y] = comps; stack.Push(y); }
                }
            }
            comps++;
        }
        int answers = 0;
        foreach (var (a, b) in queries) { ops++; if (label[a] == label[b]) answers++; }
        return (ops, comps, answers);
    }

    static (Dictionary<string, (long ops, int comps, int answers, int depth)> dsu, (long ops, int comps, int answers) trav) RunRandom(int n)
    {
        var (edges, queries) = RandomWorkload(n);
        var outp = new Dictionary<string, (long, int, int, int)>();
        foreach (var (name, rank, comp) in Variants)
        {
            var d = new DSU(n, rank, comp);
            foreach (var (a, b) in edges) d.Union(a, b);
            int builtDepth = d.Depth();
            int answers = 0;
            foreach (var (a, b) in queries) if (d.Find(a) == d.Find(b)) answers++;
            int comps = 0;
            for (int x = 0; x < n; x++) if (d.Parent[x] == x) comps++;
            outp[name] = (d.Ops, comps, answers, builtDepth);
        }
        return (outp, TraversalStatic(n, edges, queries));
    }

    // Chain workload: edge i joins element i and i+1; after every edge ask "is element 0 connected to the newest element?".
    static Dictionary<string, (long ops, int yes)> RunChain(int n)
    {
        var outp = new Dictionary<string, (long, int)>();
        foreach (var (name, rank, comp) in Variants)
        {
            var d = new DSU(n, rank, comp);
            int yes = 0;
            for (int i = 0; i < n - 1; i++)
            {
                d.Union(i, i + 1);
                if (d.Find(0) == d.Find(i + 1)) yes++;
            }
            outp[name] = (d.Ops, yes);
        }
        // Traversal has no way to add an edge to an answer already computed: after each edge it searches again from element 0.
        long ops = 0;
        int y2 = 0;
        var adj = new List<int>[n];
        for (int i = 0; i < n; i++) adj[i] = new List<int>();
        for (int i = 0; i < n - 1; i++)
        {
            adj[i].Add(i + 1);
            adj[i + 1].Add(i);
            ops++;
            var seen = new bool[n];
            seen[0] = true;
            var stack = new Stack<int>();
            stack.Push(0);
            bool found = false;
            while (stack.Count > 0 && !found)
            {
                int x = stack.Pop();
                ops++;
                if (x == i + 1) { found = true; break; }
                foreach (var y in adj[x])
                {
                    ops++;
                    if (!seen[y]) { seen[y] = true; stack.Push(y); }
                }
            }
            if (found) y2++;
        }
        outp["traversal"] = (ops, y2);
        return outp;
    }

    public static void Main()
    {
        Console.WriteLine("-- random edges: n edges, then n connectivity queries (pointer operations)");
        foreach (int n in new[] { 10, 100, 1000 })
        {
            var (dsu, trav) = RunRandom(n);
            Console.WriteLine($"  n={n}: naive {dsu["naive"].ops}, rank {dsu["rank"].ops}, compression {dsu["compression"].ops}, both {dsu["both"].ops}, " +
                $"one traversal pass {trav.ops}; components {dsu["both"].comps} (traversal {trav.comps}), connected answers {dsu["both"].answers} (traversal {trav.answers})");
        }
        Console.WriteLine("-- deepest path from any element to its root after the random edges (before any query compresses it)");
        foreach (int n in new[] { 10, 100, 1000 })
        {
            var (dsu, _) = RunRandom(n);
            Console.WriteLine($"  n={n}: naive {dsu["naive"].depth}, rank {dsu["rank"].depth}");
        }
        Console.WriteLine("-- chain: edge i joins i and i+1, then ask whether 0 is connected to the newest element, after every edge");
        foreach (int n in new[] { 10, 100, 1000 })
        {
            var r = RunChain(n);
            bool allYes = r.Values.All(v => v.yes == n - 1);
            Console.WriteLine($"  n={n}: naive {r["naive"].ops}, rank {r["rank"].ops}, compression {r["compression"].ops}, both {r["both"].ops}, " +
                $"traversal re-run after every edge {r["traversal"].ops}; every answer yes: {(allYes ? "True" : "False")}");
        }
    }
}
