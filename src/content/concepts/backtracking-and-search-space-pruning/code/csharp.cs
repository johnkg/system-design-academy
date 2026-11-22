// Backtracking with and without pruning, counted in search nodes visited (one node = one call of the recursive search).
// Two classic problems:
//   N-queens: place n queens on an n x n board so that none attacks another (rows, columns, diagonals)
//   subset sum: count the subsets of a list of positive integers that add up to a target
// Look for: the same answers from every variant, but node counts that differ by factors of thousands;
// an ordering heuristic that changes how soon the FIRST answer is found but not the work to find ALL of them;
// and an input on which pruning helps much less, because backtracking is still exponential in the worst case.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const long M = 2147483647; // Park-Miller generator, so every language produces the same numbers

    class Rng
    {
        long s;
        public Rng(long seed) { s = seed; }
        public long Next() { s = s * 48271 % M; return s; }
    }

    // ---- N-queens ----

    // No pruning: choose a column for every row (n to the power n boards), look at the board only when it is full.
    static (long solutions, long nodes) QueensGenerateAndTest(int n)
    {
        var cols = new int[n];
        long nodes = 0, solutions = 0;
        bool Ok()
        {
            for (int r = 0; r < n; r++)
                for (int s = r + 1; s < n; s++)
                    if (cols[r] == cols[s] || Math.Abs(cols[r] - cols[s]) == s - r) return false;
            return true;
        }
        void Place(int row)
        {
            nodes++;
            if (row == n) { if (Ok()) solutions++; return; }
            for (int c = 0; c < n; c++) { cols[row] = c; Place(row + 1); }
        }
        Place(0);
        return (solutions, nodes);
    }

    // Weak pruning: never reuse a column (n! boards), but still look at the diagonals only when the board is full.
    static (long solutions, long nodes) QueensPermutations(int n)
    {
        var cols = new int[n];
        var used = new bool[n];
        long nodes = 0, solutions = 0;
        bool Ok()
        {
            for (int r = 0; r < n; r++)
                for (int s = r + 1; s < n; s++)
                    if (Math.Abs(cols[r] - cols[s]) == s - r) return false;
            return true;
        }
        void Place(int row)
        {
            nodes++;
            if (row == n) { if (Ok()) solutions++; return; }
            for (int c = 0; c < n; c++)
            {
                if (!used[c]) { used[c] = true; cols[row] = c; Place(row + 1); used[c] = false; }
            }
        }
        Place(0);
        return (solutions, nodes);
    }

    static int[] ColumnOrder(int n, bool middleFirst)
    {
        var cols = Enumerable.Range(0, n);
        return (middleFirst ? cols.OrderBy(c => Math.Abs(2 * c - (n - 1))).ThenBy(c => c) : cols).ToArray();
    }

    // Full pruning: a square attacked by an earlier queen is never tried, so the search never goes below a dead end.
    static (long solutions, long nodes) QueensPruned(int n, bool middleFirst = false, bool firstOnly = false)
    {
        var order = ColumnOrder(n, middleFirst);
        var colUsed = new bool[n];
        var diag1 = new bool[2 * n]; // row + col
        var diag2 = new bool[2 * n]; // row - col + n
        long nodes = 0, solutions = 0;
        bool Place(int row)
        {
            nodes++;
            if (row == n) { solutions++; return firstOnly; }
            foreach (int c in order)
            {
                if (colUsed[c] || diag1[row + c] || diag2[row - c + n]) continue;
                colUsed[c] = diag1[row + c] = diag2[row - c + n] = true;
                bool stop = Place(row + 1);
                colUsed[c] = diag1[row + c] = diag2[row - c + n] = false;
                if (stop) return true;
            }
            return false;
        }
        Place(0);
        return (solutions, nodes);
    }

    // Nodes of a full tree with n levels and n children per node: n^0 + n^1 + ... + n^n.
    static long PowerSum(int n)
    {
        long total = 0, p = 1;
        for (int k = 0; k <= n; k++) { total += p; p *= n; }
        return total;
    }

    // ---- Subset sum ----

    static int[] MakeItems(int n)
    {
        var rng = new Rng(4242);
        var items = new int[n];
        for (int i = 0; i < n; i++) items[i] = 1 + (int)(rng.Next() % 50);
        return items;
    }

    // No pruning: every item is either in or out (2 to the power n leaves).
    static (long count, long nodes) SubsetPlain(int[] items, int target)
    {
        long nodes = 0, count = 0;
        void Go(int i, int total)
        {
            nodes++;
            if (i == items.Length) { if (total == target) count++; return; }
            Go(i + 1, total);
            Go(i + 1, total + items[i]);
        }
        Go(0, 0);
        return (count, nodes);
    }

    // Prune when the running total passes the target, or when even taking every remaining item cannot reach it.
    static (long count, long nodes) SubsetPruned(int[] items, int target, bool descending)
    {
        var seq = descending ? items.OrderByDescending(x => x).ToArray() : (int[])items.Clone();
        var suffix = new int[seq.Length + 1];
        for (int i = seq.Length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + seq[i];
        long nodes = 0, count = 0;
        void Go(int i, int total)
        {
            nodes++;
            if (total > target || total + suffix[i] < target) return;
            if (i == seq.Length) { count++; return; }
            Go(i + 1, total + seq[i]);
            Go(i + 1, total);
        }
        Go(0, 0);
        return (count, nodes);
    }

    static string Py(bool b) => b ? "True" : "False";

    public static void Main()
    {
        Console.WriteLine("-- N-queens: search nodes visited to find ALL solutions");
        foreach (int n in new[] { 4, 5, 6 })
        {
            var a = QueensGenerateAndTest(n); var b = QueensPermutations(n); var c = QueensPruned(n);
            Console.WriteLine($"  n={n}: {c.solutions} solutions; every board {a.nodes} nodes, no repeated column {b.nodes} nodes, pruned {c.nodes} nodes; all agree: {Py(a.solutions == b.solutions && b.solutions == c.solutions)}");
        }
        foreach (int n in new[] { 7, 8 })
        {
            var b = QueensPermutations(n); var c = QueensPruned(n);
            Console.WriteLine($"  n={n}: {c.solutions} solutions; every board {PowerSum(n)} nodes (counted by formula), no repeated column {b.nodes} nodes, pruned {c.nodes} nodes; agree: {Py(b.solutions == c.solutions)}");
        }
        foreach (int n in new[] { 9, 10, 11 })
        {
            var c = QueensPruned(n);
            Console.WriteLine($"  n={n}: {c.solutions} solutions; every board {PowerSum(n)} nodes (formula), pruned {c.nodes} nodes");
        }

        Console.WriteLine("-- N-queens: nodes visited to find only the FIRST solution, by column order");
        foreach (int n in new[] { 8, 12, 16, 20, 24 })
        {
            var a = QueensPruned(n, false, true); var b = QueensPruned(n, true, true);
            Console.WriteLine($"  n={n}: left to right {a.nodes} nodes, middle first {b.nodes} nodes");
        }

        Console.WriteLine("-- N-queens: nodes to find ALL solutions, whatever the column order (the order only moves WHERE the solutions are)");
        foreach (int n in new[] { 8, 10 })
            Console.WriteLine($"  n={n}: left to right {QueensPruned(n).nodes} nodes, middle first {QueensPruned(n, true).nodes} nodes");

        Console.WriteLine("-- subset sum: how many subsets add up to half of the total (nodes visited)");
        foreach (int n in new[] { 10, 16, 20 })
        {
            var items = MakeItems(n);
            int target = items.Sum() / 2;
            var a = SubsetPlain(items, target); var b = SubsetPruned(items, target, false); var c = SubsetPruned(items, target, true);
            Console.WriteLine($"  n={n}: target {target}, {a.count} subsets; no pruning {a.nodes} nodes, pruned in given order {b.nodes}, pruned largest first {c.nodes}; all agree: {Py(a.count == b.count && b.count == c.count)}");
        }
        Console.WriteLine("-- subset sum with pruning only (no pruning would visit 2^(n+1) - 1 nodes)");
        foreach (int n in new[] { 24 })
        {
            var items = MakeItems(n);
            int target = items.Sum() / 2;
            var c = SubsetPruned(items, target, true);
            Console.WriteLine($"  n={n}: {c.count} subsets, pruned largest first {c.nodes} nodes, against {(1L << (n + 1)) - 1} without pruning");
        }
        Console.WriteLine("-- a bad case for pruning: n items all equal to 2 and an odd target of n + 1 (no subset works)");
        foreach (int n in new[] { 16, 20 })
        {
            var items = Enumerable.Repeat(2, n).ToArray();
            int target = n % 2 == 0 ? n + 1 : n;
            var r = SubsetPruned(items, target, true);
            Console.WriteLine($"  n={n}: {r.count} subsets, {r.nodes} nodes pruned, against {(1L << (n + 1)) - 1} without pruning");
        }
    }
}
