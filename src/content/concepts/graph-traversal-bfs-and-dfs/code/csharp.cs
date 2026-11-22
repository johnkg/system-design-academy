// Breadth-first and depth-first search on five graph shapes, counting edge checks, the widest the waiting list gets
// (queue for BFS, stack for DFS) and how deep a recursive DFS would go. No wall-clock time anywhere.
// Look for: BFS and DFS touch the same nodes and edges, but their memory differs by shape (BFS is widest on a star or a tree,
// DFS is deepest on a chain or a grid); only BFS finds the fewest-hops path; without a visited set the work explodes or never ends.
// DFS is "recursive" in order but runs on an explicit stack here, so the program never hits a recursion limit: it reports the
// depth a real recursive version would need.
// Graphs are built from fixed integer formulas. Neighbours are listed in the order the edges were added.
using System;
using System.Collections.Generic;

public static class Program
{
    const int Cap = 100000; // the no-visited-set runs stop after this many steps, so the program still ends

    static List<int>[] Build(string shape, int n)
    {
        if (shape == "grid") // w x w squares: the largest w with w * w <= n
        {
            int g = 0;
            while ((g + 1) * (g + 1) <= n) g++;
            n = g * g;
        }
        var adj = new List<int>[n];
        for (int i = 0; i < n; i++) adj[i] = new List<int>();
        void Edge(int a, int b)
        {
            if (a != b && !adj[a].Contains(b)) { adj[a].Add(b); adj[b].Add(a); }
        }
        if (shape == "chain")
        {
            for (int v = 0; v < n - 1; v++) Edge(v, v + 1);
        }
        else if (shape == "tree") // a complete binary tree, root 0
        {
            for (int v = 1; v < n; v++) Edge((v - 1) / 2, v);
        }
        else if (shape == "star") // node 0 is a hub
        {
            for (int v = 1; v < n; v++) Edge(0, v);
        }
        else if (shape == "grid") // right and down edges added first
        {
            int w = 0;
            while ((w + 1) * (w + 1) <= n) w++;
            for (int v = 0; v < n; v++)
            {
                if (v % w < w - 1) Edge(v, v + 1);
                if (v / w < w - 1) Edge(v, v + w);
            }
        }
        else // random-looking: a ring plus one pseudo-random chord per node
        {
            for (int v = 0; v < n; v++)
            {
                Edge(v, (v + 1) % n);
                Edge(v, (int)(((long)v * 7919 + 13) % n));
            }
        }
        return adj;
    }

    // Returns (nodes taken off the queue, edge checks, widest the queue got, hops to target or -1). Stops when the target is dequeued.
    static (int, int, int, int) Bfs(List<int>[] adj, int start, int target)
    {
        var seen = new bool[adj.Length];
        var dist = new int[adj.Length];
        var queue = new List<int> { start };
        int head = 0, nodes = 0, edges = 0, widest = 0;
        seen[start] = true;
        while (head < queue.Count)
        {
            int v = queue[head++];
            nodes++;
            if (v == target) return (nodes, edges, widest, dist[v]);
            foreach (int w in adj[v])
            {
                edges++;
                if (!seen[w]) { seen[w] = true; dist[w] = dist[v] + 1; queue.Add(w); }
            }
            widest = Math.Max(widest, queue.Count - head);
        }
        return (nodes, edges, widest, -1);
    }

    // Recursive DFS on an explicit stack of (node, next neighbour index). Returns (nodes entered, edge checks, deepest recursion in
    // frames, length of the path to the target when it was entered or -1). Stops at the target.
    static (int, int, int, int) Dfs(List<int>[] adj, int start, int target)
    {
        var seen = new bool[adj.Length];
        var nodeStack = new List<int> { start };
        var nextIdx = new List<int> { 0 };
        seen[start] = true;
        int nodes = 1, edges = 0, deepest = 1;
        if (start == target) return (nodes, edges, deepest, 0);
        while (nodeStack.Count > 0)
        {
            int top = nodeStack.Count - 1;
            int v = nodeStack[top];
            if (nextIdx[top] == adj[v].Count) { nodeStack.RemoveAt(top); nextIdx.RemoveAt(top); continue; }
            int w = adj[v][nextIdx[top]++];
            edges++;
            if (!seen[w])
            {
                seen[w] = true;
                nodes++;
                nodeStack.Add(w);
                nextIdx.Add(0);
                deepest = Math.Max(deepest, nodeStack.Count);
                if (w == target) return (nodes, edges, deepest, nodeStack.Count - 1);
            }
        }
        return (nodes, edges, deepest, -1);
    }

    // The other common DFS: pop a node, skip it if seen, mark it, push all its neighbours. The stack can hold a node many times.
    static int DfsPushAll(List<int>[] adj, int start)
    {
        var seen = new bool[adj.Length];
        var stack = new List<int> { start };
        int widest = 1;
        while (stack.Count > 0)
        {
            int v = stack[stack.Count - 1];
            stack.RemoveAt(stack.Count - 1);
            if (seen[v]) continue;
            seen[v] = true;
            foreach (int w in adj[v]) if (!seen[w]) stack.Add(w);
            widest = Math.Max(widest, stack.Count);
        }
        return widest;
    }

    // Depth-first with no visited set, stopping at a step cap. Returns (steps, gave up).
    static (int, bool) WalkWithoutVisited(List<int>[] adj, int start)
    {
        int steps = 0;
        var nodeStack = new List<int> { start };
        var nextIdx = new List<int> { 0 };
        while (nodeStack.Count > 0)
        {
            steps++;
            if (steps >= Cap) return (steps, true);
            int top = nodeStack.Count - 1;
            int v = nodeStack[top];
            if (nextIdx[top] == adj[v].Count) { nodeStack.RemoveAt(top); nextIdx.RemoveAt(top); continue; }
            int w = adj[v][nextIdx[top]++];
            nodeStack.Add(w);
            nextIdx.Add(0);
        }
        return (steps, false);
    }

    // Directed chain of diamonds: both nodes of level l point to both nodes of level l + 1. Counts node entries from level 0.
    static long DiamondWalk(int levels, bool useVisited)
    {
        long entries = 0;
        var seen = new HashSet<int>();
        var stack = new Stack<(int, int)>();
        stack.Push((0, 0));
        while (stack.Count > 0)
        {
            var (level, side) = stack.Pop();
            if (useVisited)
            {
                if (!seen.Add(level * 2 + side)) continue;
            }
            entries++;
            if (level < levels) { stack.Push((level + 1, 0)); stack.Push((level + 1, 1)); }
        }
        return entries;
    }

    public static void Main()
    {
        Console.WriteLine("-- full traversal from node 0: edge checks, widest waiting list, deepest recursion");
        foreach (var shape in new[] { "chain", "tree", "star", "grid", "random" })
            foreach (int n in new[] { 100, 10000 })
            {
                var adj = Build(shape, n);
                var (nodes, edges, queue, _) = Bfs(adj, 0, -1);
                var (dn, de, depth, _) = Dfs(adj, 0, -1);
                Console.WriteLine($"{shape} n={adj.Length}: BFS visits {nodes}, {edges} edge checks, queue peaks at {queue}; DFS visits {dn}, {de} edge checks, recursion depth {depth}, push-all stack peaks at {DfsPushAll(adj, 0)}");
            }

        Console.WriteLine("-- the way to the far node (the last one; for random, the one halfway round): BFS against DFS");
        foreach (var shape in new[] { "tree", "grid", "random" })
            foreach (int n in new[] { 100, 10000 })
            {
                var adj = Build(shape, n);
                int target = shape == "random" ? adj.Length / 2 : adj.Length - 1; // random: halfway round the ring
                var (bn, _, _, hops) = Bfs(adj, 0, target);
                var (dn, _, _, length) = Dfs(adj, 0, target);
                Console.WriteLine($"{shape} n={adj.Length}: BFS path {hops} edges after visiting {bn} nodes; DFS path {length} edges after visiting {dn} nodes");
            }

        Console.WriteLine("-- without a visited set");
        foreach (var shape in new[] { "chain", "tree", "grid" })
        {
            var adj = Build(shape, 100);
            var (steps, gaveUp) = WalkWithoutVisited(adj, 0);
            Console.WriteLine($"{shape} n={adj.Length}: " + (gaveUp ? $"gave up at {steps} steps, still going" : $"finished in {steps} steps"));
        }

        foreach (int levels in new[] { 5, 10, 15, 20 })
            Console.WriteLine($"diamond chain, {levels} levels ({2 * levels + 1} nodes): without visited set {DiamondWalk(levels, false)} node entries, with one {DiamondWalk(levels, true)}");
    }
}
