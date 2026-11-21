// Trees and graphs: the cost depends on the SHAPE of the tree and on how the graph is stored, not only on n.
// Part 1: insert n keys into a plain binary search tree and into an AVL tree (a self-balancing tree), count comparisons and height.
// Part 2: breadth-first search, depth-first search and Dijkstra on a graph stored as an adjacency list or an adjacency matrix.
// Look for: sorted keys turn the plain tree into a chain (height n); the matrix needs V*V cells and V*V steps; a BFS with no
// visited set never ends on a graph with a cycle; Dijkstra with a heap needs far fewer steps than Dijkstra with a scan.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    // ---------- Part 1: trees ----------
    static List<long> KeyOrder(string order, int n)
    {
        var keys = new List<long>();
        if (order == "sorted") for (int i = 1; i <= n; i++) keys.Add(i);
        else if (order == "zigzag") { long lo = 1, hi = n; while (lo <= hi) { keys.Add(lo++); if (lo <= hi) keys.Add(hi--); } }
        else
        { // a fixed pseudo-random permutation of 1..n (Fisher-Yates driven by an integer generator)
            for (int i = 1; i <= n; i++) keys.Add(i);
            long x = 777;
            for (int i = n - 1; i > 0; i--)
            {
                x = (x * 1664525 + 1013904223) % 4294967296;
                int j = (int)((x / 65536) % (i + 1));
                (keys[i], keys[j]) = (keys[j], keys[i]);
            }
        }
        return keys;
    }

    // Plain binary search tree. One comparison per node visited on the way down. Iterative, so a chain cannot overflow the stack.
    static (long comparisons, int height, Func<long, int> lookup) PlainTree(List<long> keys)
    {
        var key = new List<long>(); var left = new List<int>(); var right = new List<int>();
        long comparisons = 0; int height = 0;
        foreach (var k in keys)
        {
            if (key.Count == 0) { key.Add(k); left.Add(-1); right.Add(-1); height = 1; continue; }
            int at = 0, depth = 1;
            for (;;)
            {
                comparisons++;
                var side = k < key[at] ? left : right;
                if (side[at] == -1) { key.Add(k); left.Add(-1); right.Add(-1); side[at] = key.Count - 1; depth++; break; }
                at = side[at]; depth++;
            }
            height = Math.Max(height, depth);
        }
        int Lookup(long k)
        {
            int at = 0, c = 0;
            while (at != -1) { c++; if (k == key[at]) break; at = k < key[at] ? left[at] : right[at]; }
            return c;
        }
        return (comparisons, height, Lookup);
    }

    // AVL tree: after every insert, a node whose two sides differ in height by more than 1 is rotated, so height stays below 1.45 * log2(n + 2).
    class Node { public long K; public Node? L, R; public int H = 1; public Node(long k) { K = k; } }

    static (long comparisons, int height, Func<long, int> lookup) AvlTree(List<long> keys)
    {
        long comparisons = 0;
        int H(Node? t) => t == null ? 0 : t.H;
        void Fix(Node t) { t.H = 1 + Math.Max(H(t.L), H(t.R)); }
        Node RotR(Node t) { var l = t.L!; t.L = l.R; l.R = t; Fix(t); Fix(l); return l; }
        Node RotL(Node t) { var r = t.R!; t.R = r.L; r.L = t; Fix(t); Fix(r); return r; }
        Node Insert(Node? t, long k)
        {
            if (t == null) return new Node(k);
            comparisons++;
            if (k < t.K) t.L = Insert(t.L, k); else t.R = Insert(t.R, k);
            Fix(t);
            int bal = H(t.L) - H(t.R);
            if (bal > 1) { if (H(t.L!.L) < H(t.L.R)) t.L = RotL(t.L); return RotR(t); }
            if (bal < -1) { if (H(t.R!.R) < H(t.R.L)) t.R = RotR(t.R); return RotL(t); }
            return t;
        }
        Node? root = null;
        foreach (var k in keys) root = Insert(root, k);
        int Lookup(long k)
        {
            var t = root; int c = 0;
            while (t != null) { c++; if (k == t.K) break; t = k < t.K ? t.L : t.R; }
            return c;
        }
        return (comparisons, H(root), Lookup);
    }

    // ---------- Part 2: graphs ----------
    // A circulant graph: vertex i is joined to i+1 and i+2 (wrapping round), so every vertex has 4 neighbours and there are 2V edges.
    static int[] Neighbours(int V, int i) => new[] { (i + 1) % V, (i + 2) % V, (i + V - 1) % V, (i + V - 2) % V };
    static long Weight(int i, int j) => 1 + (((i + j) * 7 + Math.Abs(i - j) * 3) % 9); // symmetric, 1..9

    // Breadth-first search from vertex 0. A step is a vertex taken off the queue, or an edge (list) / cell (matrix) examined.
    static (long steps, bool finished, int reached) Bfs(int V, bool useMatrix, bool useVisited, long cap)
    {
        byte[][]? matrix = null;
        if (useMatrix)
        {
            matrix = new byte[V][];
            for (int i = 0; i < V; i++) { matrix[i] = new byte[V]; foreach (var j in Neighbours(V, i)) matrix[i][j] = 1; }
        }
        var visited = new byte[V];
        var queue = new List<int> { 0 };
        if (useVisited) visited[0] = 1;
        int head = 0, reached = 1; long steps = 0;
        while (head < queue.Count)
        {
            if (steps >= cap) return (steps, false, reached);
            int v = queue[head++]; steps++;
            if (useMatrix)
            {
                for (int j = 0; j < V; j++) { steps++; if (matrix![v][j] == 1 && visited[j] == 0) { visited[j] = 1; reached++; queue.Add(j); } }
            }
            else
            {
                foreach (var j in Neighbours(V, v))
                {
                    steps++;
                    if (!useVisited) queue.Add(j); // no visited set: every edge examined is queued again
                    else if (visited[j] == 0) { visited[j] = 1; reached++; queue.Add(j); }
                }
            }
        }
        return (steps, true, reached);
    }

    // Recursive depth-first search on a path of V vertices (the worst shape): the recursion is V frames deep.
    static int DfsDepth(int V)
    {
        var seen = new byte[V]; int deepest = 0;
        void Go(int v, int depth)
        {
            seen[v] = 1; deepest = Math.Max(deepest, depth);
            int j = v + 1;
            if (j < V && seen[j] == 0) Go(j, depth + 1);
        }
        Go(0, 1);
        return deepest;
    }

    // Dijkstra with a binary heap (lazy deletion): counts heap comparisons, pops and edges relaxed.
    static (long steps, long sum) DijkstraHeap(int V)
    {
        var dist = new long[V]; Array.Fill(dist, long.MaxValue);
        var done = new byte[V]; var heap = new List<(long d, int v)>();
        long steps = 0;
        bool Less((long d, int v) a, (long d, int v) b) { steps++; return a.d < b.d; }
        void Swap(int a, int b) { (heap[a], heap[b]) = (heap[b], heap[a]); }
        void Push((long d, int v) e)
        {
            heap.Add(e); int i = heap.Count - 1;
            while (i > 0) { int p = (i - 1) >> 1; if (Less(heap[i], heap[p])) { Swap(i, p); i = p; } else break; }
        }
        (long d, int v) Pop()
        {
            var top = heap[0]; var last = heap[heap.Count - 1]; heap.RemoveAt(heap.Count - 1);
            if (heap.Count > 0)
            {
                heap[0] = last; int i = 0;
                for (;;)
                {
                    int l = 2 * i + 1, r = l + 1, s = i;
                    if (l < heap.Count && Less(heap[l], heap[s])) s = l;
                    if (r < heap.Count && Less(heap[r], heap[s])) s = r;
                    if (s == i) break;
                    Swap(i, s); i = s;
                }
            }
            return top;
        }
        dist[0] = 0; Push((0, 0));
        while (heap.Count > 0)
        {
            var (d, v) = Pop(); steps++;
            if (done[v] == 1) continue;
            done[v] = 1;
            foreach (var j in Neighbours(V, v))
            {
                steps++;
                if (d + Weight(v, j) < dist[j]) { dist[j] = d + Weight(v, j); Push((dist[j], j)); }
            }
        }
        return (steps, dist.Sum());
    }

    // Dijkstra with a scan: every round looks at all V vertices to find the nearest unfinished one.
    static (long steps, long sum) DijkstraScan(int V)
    {
        var dist = new long[V]; Array.Fill(dist, long.MaxValue);
        var done = new byte[V]; long steps = 0;
        dist[0] = 0;
        for (int round = 0; round < V; round++)
        {
            int v = -1;
            for (int i = 0; i < V; i++) { steps++; if (done[i] == 0 && (v == -1 || dist[i] < dist[v])) v = i; }
            done[v] = 1;
            foreach (var j in Neighbours(V, v)) { steps++; if (dist[v] + Weight(v, j) < dist[j]) dist[j] = dist[v] + Weight(v, j); }
        }
        return (steps, dist.Sum());
    }

    // The step formulas used by the simulation (E counts each undirected edge once, so there are 2E arcs).
    static long BfsList(long V, long E) => V + 2 * E;
    static long BfsMatrix(long V) => V + V * V;
    static long DijkstraHeapFormula(long V, long E) => (V + 2 * E) * (long)Math.Ceiling(Math.Log2(V));
    static long DijkstraScanFormula(long V, long E) => V * V + 2 * E;
    // On a matrix, finding the neighbours of a vertex scans a whole row: V cells for each of V vertices.
    static long DijkstraHeapMatrix(long V, long E) => V * V + (V + 2 * E) * (long)Math.Ceiling(Math.Log2(V));
    static long DijkstraScanMatrix(long V) => 2 * V * V;
    static long ListCells(long V, long E) => V + 2 * E;
    static long MatrixCells(long V) => V * V;

    public static void Main()
    {
        Console.WriteLine("-- n keys inserted into a plain tree and an AVL tree, then n lookups (comparisons)");
        foreach (int n in new[] { 10, 100, 1000 })
        {
            foreach (var order in new[] { "random", "sorted", "zigzag" })
            {
                var keys = KeyOrder(order, n);
                var p = PlainTree(keys); var a = AvlTree(keys);
                long lp = 0, la = 0;
                foreach (var k in keys) { lp += p.lookup(k); la += a.lookup(k); }
                Console.WriteLine($"n={n} {order}: plain height {p.height}, build {p.comparisons}, lookups {lp}; AVL height {a.height}, build {a.comparisons}, lookups {la}");
            }
            Console.WriteLine($"n={n}: the smallest possible height is {(int)Math.Ceiling(Math.Log2(n + 1))}");
        }

        Console.WriteLine("-- breadth-first search from vertex 0, 4 neighbours per vertex (E = 2V)");
        foreach (int V in new[] { 10, 100, 1000 })
        {
            long E = 2L * V;
            var l = Bfs(V, false, true, 1_000_000_000); var m = Bfs(V, true, true, 1_000_000_000);
            Console.WriteLine($"V={V}: list {l.steps} steps (formula {BfsList(V, E)}), matrix {m.steps} steps (formula {BfsMatrix(V)}), reached {l.reached}");
            Console.WriteLine($"V={V}: memory list {ListCells(V, E)} cells, matrix {MatrixCells(V)} cells");
        }
        Console.WriteLine("-- the same search with no visited set, capped at 1000000 steps");
        foreach (int V in new[] { 10, 100 })
        {
            var r = Bfs(V, false, false, 1000000);
            Console.WriteLine($"V={V}: {(r.finished ? "finished" : "did not finish")} after {r.steps} steps");
        }
        Console.WriteLine($"-- recursive depth-first search on a path of 1000 vertices: {DfsDepth(1000)} frames deep");
        Console.WriteLine("-- Dijkstra from vertex 0: heap against scan (real steps, then the formula)");
        foreach (int V in new[] { 10, 100, 1000 })
        {
            long E = 2L * V;
            var h = DijkstraHeap(V); var s = DijkstraScan(V);
            Console.WriteLine($"V={V}: heap {h.steps} (formula {DijkstraHeapFormula(V, E)}), scan {s.steps} (formula {DijkstraScanFormula(V, E)}), same distances {(h.sum == s.sum ? "true" : "false")}");
        }
        Console.WriteLine("-- by the formulas at V = 100000 and E = 2V (sparse)");
        {
            long V = 100000, E = 2 * V;
            Console.WriteLine($"list {ListCells(V, E)} cells, matrix {MatrixCells(V)} cells");
            Console.WriteLine($"BFS: list {BfsList(V, E)} steps, matrix {BfsMatrix(V)} steps");
            Console.WriteLine($"Dijkstra: heap {DijkstraHeapFormula(V, E)} steps, scan {DijkstraScanFormula(V, E)} steps");
            Console.WriteLine($"Dijkstra on a matrix: heap {DijkstraHeapMatrix(V, E)} steps, scan {DijkstraScanMatrix(V)} steps");
            Console.WriteLine($"100 separate searches instead of one: {100 * BfsList(V, E)} steps against {BfsList(V, E)}");
        }
    }
}
