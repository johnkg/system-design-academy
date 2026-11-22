// Divide and conquer: merge sort counted in comparisons and element copies, the cost of splitting unevenly,
// the master-theorem recurrence T(n) = a T(n/b) + f(n) evaluated level by level, and work against span (parallel potential).
// Nothing is timed. Look for:
//   - merge sort costs about n log2 n operations, insertion sort (no divide) about n squared / 4 comparisons plus as many moves
//   - a split at a fixed fraction (25%, 10%) is still n log n with a larger constant; peeling off ONE element is quadratic
//   - which level of the recursion tree dominates decides the total: leaves, every level equally, or the root
//   - the sequential merge at the top of the tree limits parallel speed-up (span), long before processors run out
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

    static int[] MakeData(int n)
    {
        var rng = new Rng(31337);
        var data = new int[n];
        for (int i = 0; i < n; i++) data[i] = (int)(rng.Next() % 100000);
        return data;
    }

    static int CeilLog2(int n)
    {
        int k = 0;
        while ((1L << k) < n) k++;
        return k;
    }

    // Merge sort that splits at pct percent of the list (pct 0 means: peel off exactly one element).
    // Counts: comparisons while merging, copies (every element is written once per merge), deepest recursion.
    static (int[] result, long cmp, long copy, int depth) MergeSort(int[] a, int pct)
    {
        long cmp = 0, copy = 0;
        int maxDepth = 0;
        int[] Sort(int[] xs, int depth)
        {
            maxDepth = Math.Max(maxDepth, depth);
            int n = xs.Length;
            if (n <= 1) return xs;
            int leftN = pct == 0 ? 1 : Math.Max(1, Math.Min(n - 1, n * pct / 100));
            var left = Sort(xs[..leftN], depth + 1);
            var right = Sort(xs[leftN..], depth + 1);
            var o = new List<int>(n);
            int i = 0, j = 0;
            while (i < left.Length && j < right.Length)
            {
                cmp++;
                if (left[i] <= right[j]) o.Add(left[i++]);
                else o.Add(right[j++]);
            }
            while (i < left.Length) o.Add(left[i++]);
            while (j < right.Length) o.Add(right[j++]);
            copy += n;
            return o.ToArray();
        }
        var result = Sort((int[])a.Clone(), 1);
        return (result, cmp, copy, maxDepth);
    }

    static (long cmp, long moves) InsertionSort(int[] a)
    {
        var xs = (int[])a.Clone();
        long cmp = 0, moves = 0;
        for (int i = 1; i < xs.Length; i++)
        {
            int v = xs[i];
            int j = i - 1;
            while (j >= 0)
            {
                cmp++;
                if (xs[j] > v) { xs[j + 1] = xs[j]; moves++; j--; }
                else break;
            }
            xs[j + 1] = v;
        }
        return (cmp, moves);
    }

    // ---- Recurrence T(n) = a T(n/b) + f(n), with T(1) = 1, for n = b^k, evaluated level by level ----
    static long Pow(long x, int e) { long r = 1; for (int i = 0; i < e; i++) r *= x; return r; }
    static long FOf(string kind, long m) => kind == "1" ? 1 : kind == "n" ? m : m * m;
    static int FExp(string kind) => kind == "1" ? 0 : kind == "n" ? 1 : 2;

    static readonly (string name, int a, int b, string kind)[] Cases =
    {
        ("merge sort", 2, 2, "n"),
        ("binary search", 1, 2, "1"),
        ("tree sum", 2, 2, "1"),
        ("split in 4, combine in n", 4, 2, "n"),
        ("expensive combine n^2", 2, 2, "n2"),
        ("naive matrix multiply", 8, 2, "n2"),
        ("Strassen", 7, 2, "n2"),
    };

    static (long total, long root, long leaves) Recurrence(int a, int b, string kind, int k)
    {
        long n = Pow(b, k);
        long total = 0, root = 0;
        for (int i = 0; i < k; i++)
        {
            long level = Pow(a, i) * FOf(kind, n / Pow(b, i));
            if (i == 0) root = level;
            total += level;
        }
        long leaves = Pow(a, k);
        return (total + leaves, root, leaves);
    }

    static string Verdict(int a, int b, string kind)
    {
        long bc = Pow(b, FExp(kind));
        if (a > bc) return "leaves dominate";
        if (a == bc) return "every level costs the same";
        return "root dominates";
    }

    // ---- Work and span of merge sort (model, n = 2^k) ----
    static long Work(int k) => Recurrence(2, 2, "n", k).total;
    static long SpanSequentialMerge(int k) => (1L << (k + 1)) - 1; // S(n) = S(n/2) + n, S(1) = 1
    static long SpanParallelMerge(int k) { long s = 1; for (long j = 1; j <= k; j++) s += j * j; return s; } // model: merging m items has span (ceil log2 m)^2

    public static void Main()
    {
        Console.WriteLine("-- merge sort (split in half): comparisons + copies against n * ceil(log2 n)");
        foreach (int n in new[] { 10, 100, 1000, 10000, 100000 })
        {
            var data = MakeData(n);
            var (result, cmp, copy, depth) = MergeSort(data, 50);
            var sorted = data.OrderBy(x => x).ToArray();
            if (!result.SequenceEqual(sorted)) throw new Exception("not sorted");
            Console.WriteLine($"  n={n}: {cmp} comparisons + {copy} copies = {cmp + copy}, n*ceil(log2 n) = {(long)n * CeilLog2(n)}, depth {depth}");
        }
        Console.WriteLine("-- no divide: insertion sort on the same data (comparisons + moves)");
        foreach (int n in new[] { 10, 100, 1000 })
        {
            var (cmp, moves) = InsertionSort(MakeData(n));
            Console.WriteLine($"  n={n}: {cmp} comparisons + {moves} moves = {cmp + moves}");
        }

        Console.WriteLine("-- merge sort with an uneven split: total operations (comparisons + copies) and recursion depth");
        foreach (int n in new[] { 100, 1000, 2000 })
        {
            var row = new List<string>();
            foreach (var (label, pct) in new[] { ("50%", 50), ("25%", 25), ("10%", 10), ("one element", 0) })
            {
                var (_, cmp, copy, depth) = MergeSort(MakeData(n), pct);
                row.Add($"{label}: {cmp + copy} ops, depth {depth}");
            }
            Console.WriteLine($"  n={n}: {string.Join("; ", row)}");
        }

        Console.WriteLine("-- recurrence T(n) = a T(n/b) + f(n), total work, cost of the root level, cost of the leaf level");
        foreach (int k in new[] { 10, 16 })
        {
            Console.WriteLine($"  n = 2^{k} = {1L << k}");
            foreach (var (name, a, b, kind) in Cases)
            {
                var (total, root, leaves) = Recurrence(a, b, kind, k);
                Console.WriteLine($"    {name} (a={a}, b={b}, f={kind}): total {total}, root level {root}, leaf level {leaves}: {Verdict(a, b, kind)}");
            }
        }

        Console.WriteLine("-- parallel potential of merge sort: work, span, and the best possible time on p workers");
        foreach (int k in new[] { 10, 20 })
        {
            long w = Work(k), s1 = SpanSequentialMerge(k), s2 = SpanParallelMerge(k);
            Console.WriteLine($"  n = 2^{k}: work {w}; sequential merge: span {s1}, parallelism {w / s1}; parallel merge (model): span {s2}, parallelism {w / s2}");
            foreach (int p in new[] { 4, 16, 64, 1024 })
            {
                long wp = (w + p - 1) / p;
                Console.WriteLine($"    p={p}: sequential merge at least {Math.Max(wp, s1)} steps, parallel merge at least {Math.Max(wp, s2)} steps (work/p = {wp})");
            }
        }
    }
}
