// Two uses of randomness, with a seeded generator so every run (and every language) prints the same numbers.
// Part 1: quicksort with the first element as pivot against a random pivot, counted in comparisons (one per element tested
//         against the pivot). Look for: sorted input is the worst case for the first-element pivot (n(n-1)/2 comparisons), while
//         a random pivot has no bad input, only bad luck: over 20 seeds on the same sorted input the count stays within a narrow band.
// Part 2: reservoir sampling (Algorithm R): keep k items from a stream of unknown length, using k cells. Look for: every item is
//         kept with the same chance k/n; a plausible-looking shortcut ("replace a random cell half the time") favours late items.
// The generator is the Park-Miller "minimal standard": x = x * 16807 mod 2147483647. The product stays below 2^53, so plain
// 64-bit floats (JavaScript), big integers (Python) and 64-bit integers (C#) all compute it exactly and agree.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const long Mod = 2147483647;

    static Func<int, int> MakeRng(long seed)
    {
        long x = seed;
        return (m) => { x = (x * 16807) % Mod; return (int)(x % m); }; // an integer in 0 .. m-1 (the tiny modulo bias is ignored here)
    }

    static int[] Shuffled(int n, long seed)
    {
        var a = Enumerable.Range(1, n).ToArray();
        var rand = MakeRng(seed);
        for (int i = n - 1; i > 0; i--) { int j = rand(i + 1); (a[i], a[j]) = (a[j], a[i]); }
        return a;
    }

    // Iterative quicksort (a sorted input would make the recursion n levels deep). Lomuto partition with the pivot moved to the front.
    static long Quicksort(int[] input, string pivotRule, long seed)
    {
        var a = (int[])input.Clone();
        var rand = MakeRng(seed);
        long comparisons = 0;
        var stack = new Stack<(int lo, int hi)>();
        stack.Push((0, a.Length - 1));
        while (stack.Count > 0)
        {
            var (lo, hi) = stack.Pop();
            if (lo >= hi) continue;
            if (pivotRule == "random") { int p = lo + rand(hi - lo + 1); (a[lo], a[p]) = (a[p], a[lo]); }
            int pivot = a[lo];
            int i = lo;
            for (int j = lo + 1; j <= hi; j++)
            {
                comparisons++;
                if (a[j] < pivot) { i++; (a[i], a[j]) = (a[j], a[i]); }
            }
            (a[lo], a[i]) = (a[i], a[lo]);
            stack.Push((lo, i - 1));
            stack.Push((i + 1, hi));
        }
        for (int i = 1; i < a.Length; i++) if (a[i - 1] > a[i]) throw new Exception("not sorted");
        return comparisons;
    }

    static int[] SortedInput(int n) => Enumerable.Range(1, n).ToArray();

    // Reservoir sampling. rule "reservoir": item i (0-based, after the first k) replaces cell j = rand(i+1) when j < k.
    // rule "naive": after the first k, replace a random cell with probability 1/2 (looks fair, is not). rule "first": keep the first k.
    static (List<int> cells, int writes) Sample(int n, int k, string rule, Func<int, int> rand)
    {
        var cells = new List<int>();
        int writes = 0;
        for (int i = 0; i < n; i++)
        {
            int item = i + 1;
            if (i < k) { cells.Add(item); writes++; continue; }
            if (rule == "reservoir") { int j = rand(i + 1); if (j < k) { cells[j] = item; writes++; } }
            else if (rule == "naive") { if (rand(2) == 0) { cells[rand(k)] = item; writes++; } }
        }
        return (cells, writes);
    }

    public static void Main()
    {
        foreach (int n in new[] { 100, 1000, 10000 })
        {
            Console.WriteLine($"quicksort, n={n}");
            Console.WriteLine($"  sorted input: first-element pivot {Quicksort(SortedInput(n), "first", 1)}, random pivot {Quicksort(SortedInput(n), "random", 1)} (n(n-1)/2 is {(long)n * (n - 1) / 2})");
            Console.WriteLine($"  shuffled input: first-element pivot {Quicksort(Shuffled(n, 99), "first", 1)}, random pivot {Quicksort(Shuffled(n, 99), "random", 1)}");
        }
        long lowest = long.MaxValue, highest = 0, total = 0;
        for (int seed = 1; seed <= 20; seed++)
        {
            long c = Quicksort(SortedInput(1000), "random", seed);
            lowest = Math.Min(lowest, c); highest = Math.Max(highest, c); total += c;
        }
        Console.WriteLine($"random pivot on sorted input, n=1000, seeds 1 to 20: lowest {lowest}, highest {highest}, mean {total / 20}");

        int trials = 10000, nn = 10, kk = 3;
        Console.WriteLine($"how often each of {nn} items is kept in a sample of {kk}, over {trials} runs (fair is {trials * kk / nn} each)");
        foreach (var rule in new[] { "reservoir", "naive", "first" })
        {
            var rand = MakeRng(7);
            var counts = new int[nn];
            for (int t = 0; t < trials; t++) foreach (int item in Sample(nn, kk, rule, rand).cells) counts[item - 1]++;
            Console.WriteLine($"  {rule}: {string.Join(" ", counts)}");
        }
        foreach (int size in new[] { 1000, 1000000 })
        {
            var s = Sample(size, 5, "reservoir", MakeRng(2024));
            Console.WriteLine($"one pass over {size} items, k=5: kept [{string.Join(", ", s.cells)}] after {s.writes} writes, using 5 cells instead of {size}");
        }
    }
}
