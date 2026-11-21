// Naive recursion vs memoization vs bottom-up tabulation, counted in function calls, cache entries and stack depth.
// Every problem is described by one function: given a state (an integer key), which sub-states does it call?
// Look for: naive calls explode with n while memoized calls grow in step with the number of distinct states;
// the tree sum has NO overlapping subproblems, so its cache is pure overhead; greedy gives wrong coin answers.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;

public static class Program
{
    const long Cap = 1_000_000_000_000_000; // naive counts above this are reported as "more than 1e15"

    record Problem(Func<long, long> Start, Func<long, long, List<long>> Children, Func<long, long> Cells);

    static Problem Fib() => new(n => n, (k, n) => k < 2 ? new() : new() { k - 1, k - 2 }, n => n + 1);

    // A grid state is r*1000 + c: paths from (r,c) to the edge (r=0 or c=0), moving up or left one step at a time.
    static Problem Grid() => new(n => n * 1000 + n, (k, n) => k / 1000 == 0 || k % 1000 == 0 ? new() : new() { k - 1000, k - 1 }, n => (n + 1) * (n + 1));

    // Fewest coins for an amount: every coin that fits is a sub-call.
    static Problem Coins(int[] set) => new(n => n, (a, n) => a == 0 ? new() : set.Where(c => c <= a).Select(c => a - c).ToList(), n => n + 1);

    // Same problem, but the cache key also holds "coins used so far" (key = amount*1000 + used): too much state in the key.
    static Problem CoinsBadKey(int[] set) => new(n => n * 1000, (k, n) =>
    {
        long a = k / 1000, u = k % 1000;
        return a == 0 ? new() : set.Where(c => c <= a).Select(c => (a - c) * 1000 + u + 1).ToList();
    }, n => n + 1);

    // A complete binary tree of the given depth, nodes numbered like a heap (root 1, children 2i and 2i+1): summing it never revisits a node.
    static Problem Tree() => new(n => 1, (i, d) => 63 - System.Numerics.BitOperations.LeadingZeroCount((ulong)i) >= d ? new() : new() { 2 * i, 2 * i + 1 }, d => (1L << (int)(d + 1)) - 1);

    // Calls made by the NAIVE recursion, without running it: calls(state) = 1 + sum of calls(children), with a table
    // so that 2^n calls are never executed. Saturates at Cap.
    static long Naive(Problem p, long n)
    {
        var memo = new Dictionary<long, long>();
        long Calls(long k)
        {
            if (memo.TryGetValue(k, out var hit)) return hit;
            long total = 1;
            foreach (var c in p.Children(k, n)) total = Math.Min(Cap, total + Calls(c));
            memo[k] = total;
            return total;
        }
        return Calls(p.Start(n));
    }

    // Longest chain of nested calls (stack frames) of the recursion, same table trick.
    static long Depth(Problem p, long n)
    {
        var memo = new Dictionary<long, long>();
        long D(long k)
        {
            if (memo.TryGetValue(k, out var hit)) return hit;
            long best = 0;
            foreach (var c in p.Children(k, n)) best = Math.Max(best, D(c));
            memo[k] = best + 1;
            return best + 1;
        }
        return D(p.Start(n));
    }

    // The memoized recursion, really executed: a call that finds its key in the cache returns at once.
    static (long calls, int entries) Memoized(Problem p, long n)
    {
        var cache = new HashSet<long>();
        long calls = 0;
        void F(long k)
        {
            calls++;
            if (cache.Contains(k)) return;
            foreach (var c in p.Children(k, n)) F(c);
            cache.Add(k);
        }
        F(p.Start(n));
        return (calls, cache.Count);
    }

    // The naive recursion, really executed, to check that the counting model above is exact.
    static long RunNaive(Problem p, long n)
    {
        long calls = 0;
        void F(long k) { calls++; foreach (var c in p.Children(k, n)) F(c); }
        F(p.Start(n));
        return calls;
    }

    static string Fmt(long x) => x >= Cap ? "more than 1e15" : x.ToString();

    static void Report(string label, Problem p, long[] sizes)
    {
        Console.WriteLine($"-- {label}");
        foreach (var n in sizes)
        {
            var m = Memoized(p, n);
            Console.WriteLine($"  n={n}: naive {Fmt(Naive(p, n))} calls, memoized {m.calls} calls and {m.entries} entries, bottom-up {p.Cells(n)} cells, stack depth {Depth(p, n)}");
        }
    }

    // Smallest n where the naive recursion needs more than one billion calls.
    static long Billion(Problem p, int limit)
    {
        for (int n = 1; n <= limit; n++) if (Naive(p, n) > 1_000_000_000) return n;
        return -1;
    }

    // Greedy (take the biggest coin that fits) against the optimum (bottom-up table).
    static int Greedy(int[] set, int amount)
    {
        int left = amount, used = 0;
        foreach (var c in set.OrderByDescending(x => x)) { used += left / c; left %= c; }
        return used;
    }

    static int Best(int[] set, int amount)
    {
        var t = new int[amount + 1];
        for (int a = 1; a <= amount; a++)
        {
            t[a] = int.MaxValue;
            foreach (var c in set) if (c <= a) t[a] = Math.Min(t[a], t[a - c] + 1);
        }
        return t[amount];
    }

    public static void Main()
    {
        Report("Fibonacci", Fib(), new long[] { 10, 20, 30, 40 });
        Report("Grid paths, n x n", Grid(), new long[] { 4, 8, 12, 16 });
        Report("Coin change {1,5,10,25}", Coins(new[] { 1, 5, 10, 25 }), new long[] { 30, 60, 90 });
        Report("Coin change {1,5,10,25} with a bad cache key (amount, coins used)", CoinsBadKey(new[] { 1, 5, 10, 25 }), new long[] { 30, 60 });
        Report("Sum of a complete tree of depth n (nothing overlaps)", Tree(), new long[] { 5, 10, 15 });

        Console.WriteLine("-- the model is exact: running the naive recursion gives the same count");
        foreach (var (label, p, n) in new[] { ("fib 20", Fib(), 20L), ("grid 8", Grid(), 8L), ("coins 40", Coins(new[] { 1, 5, 10, 25 }), 40L), ("tree 10", Tree(), 10L) })
        {
            long ran = RunNaive(p, n), modelled = Naive(p, n);
            Console.WriteLine($"  {label}: run {ran}, model {modelled}, {(ran == modelled ? "same" : "DIFFERENT")}");
        }

        Console.WriteLine("-- first n where naive recursion passes 1,000,000,000 calls");
        Console.WriteLine($"  Fibonacci: n={Billion(Fib(), 100)}");
        Console.WriteLine($"  Grid paths: n={Billion(Grid(), 40)}");
        Console.WriteLine($"  Coins {{1,5,10,25}}: amount={Billion(Coins(new[] { 1, 5, 10, 25 }), 500)}");
        Console.WriteLine($"  Coins {{1,3,4}}: amount={Billion(Coins(new[] { 1, 3, 4 }), 500)}");
        int treeDepth = 1;
        while ((1L << (treeDepth + 1)) - 1 <= 1_000_000_000) treeDepth++;
        Console.WriteLine($"  Tree: depth={treeDepth}");

        Console.WriteLine("-- greedy against optimal");
        foreach (var (set, amount) in new[] { (new[] { 1, 5, 10, 25 }, 63), (new[] { 1, 3, 4 }, 6), (new[] { 1, 7, 10 }, 14), (new[] { 1, 5, 12 }, 15) })
        {
            int g = Greedy(set, amount), o = Best(set, amount);
            Console.WriteLine($"  coins {{{string.Join(",", set)}}} amount {amount}: greedy {g}, optimal {o}{(g == o ? "" : " (greedy is wrong)")}");
        }
    }
}
