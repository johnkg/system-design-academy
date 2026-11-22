// Two pointers and a sliding window, counted in steps (one pair checked, or one element added to or removed from a window).
// Look for: on a sorted list, two pointers find a pair in at most n - 1 checks where trying every pair needs n(n-1)/2;
// on positive numbers, a window finds the longest stretch with sum <= K in at most 2n steps; with negative numbers the
// same window code is fast but WRONG, and the only simple fix is back to the O(n^2) loops.
// Data comes from fixed integer formulas, so every language prints the same numbers.
using System;

public static class Program
{
    // strictly increasing: the steps between neighbours are 1 to 5
    static int[] SortedList(int n)
    {
        var a = new int[n];
        for (int i = 0; i < n; i++) a[i] = 3 * i + (i * 7 + 1) % 3;
        return a;
    }

    static (long, bool) PairBrute(int[] a, int target)
    {
        long steps = 0;
        for (int i = 0; i < a.Length; i++)
            for (int j = i + 1; j < a.Length; j++)
            {
                steps++;
                if (a[i] + a[j] == target) return (steps, true);
            }
        return (steps, false);
    }

    static (long, bool) PairTwoPointers(int[] a, int target)
    {
        int lo = 0, hi = a.Length - 1;
        long steps = 0;
        while (lo < hi)
        {
            steps++;
            int s = a[lo] + a[hi];
            if (s == target) return (steps, true);
            if (s < target) lo++; // the pair (lo, anything left of hi) is too small
            else hi--; // the pair (anything right of lo, hi) is too big
        }
        return (steps, false);
    }

    // positive: 1..9. mixed: -3..5, so some elements pull the sum back down.
    static int[] Values(int n, string mode)
    {
        var v = new int[n];
        for (int i = 0; i < n; i++) v[i] = (i * 7 + 3) % 9 + (mode == "positive" ? 1 : -3);
        return v;
    }

    // Longest stretch with sum <= k. With positive numbers a sum can only grow, so each start stops at the first sum > k.
    // With negative numbers a later element can bring the sum back down, so each start must look at every end.
    static (long, int) WindowBrute(int[] v, int k, string mode)
    {
        int best = 0;
        long steps = 0;
        for (int l = 0; l < v.Length; l++)
        {
            int s = 0;
            for (int r = l; r < v.Length; r++)
            {
                s += v[r];
                steps++;
                if (s <= k) best = Math.Max(best, r - l + 1);
                else if (mode == "positive") break;
            }
        }
        return (steps, best);
    }

    // The usual window: grow on the right, shrink from the left while the sum is too big.
    static (long, int) WindowSliding(int[] v, int k)
    {
        int best = 0, l = 0, s = 0;
        long steps = 0;
        for (int r = 0; r < v.Length; r++)
        {
            s += v[r];
            steps++;
            while (s > k && l <= r)
            {
                s -= v[l];
                l++;
                steps++;
            }
            best = Math.Max(best, r - l + 1);
        }
        return (steps, best);
    }

    public static void Main()
    {
        Console.WriteLine("-- a pair that adds up to a target in a sorted list: every pair against two pointers");
        foreach (int n in new[] { 10, 100, 1000, 10000 })
        {
            var a = SortedList(n);
            foreach (var (name, target) in new[] { ("no pair exists", 1), ("a pair exists", a[n / 4] + a[3 * n / 4]) })
            {
                var (bs, bf) = PairBrute(a, target);
                var (ts, tf) = PairTwoPointers(a, target);
                Console.WriteLine($"n={n} {name}: every pair {bs} checks (found {bf.ToString().ToLower()}), two pointers {ts} checks (found {tf.ToString().ToLower()})");
            }
        }

        Console.WriteLine("-- longest stretch with sum <= K: try every start against a sliding window");
        foreach (var mode in new[] { "positive", "mixed" })
            foreach (int n in new[] { 10, 100, 1000, 10000 })
            {
                var v = Values(n, mode);
                foreach (int k in new[] { 50, 500 })
                {
                    var (bs, bb) = WindowBrute(v, k, mode);
                    var (ws, wb) = WindowSliding(v, k);
                    string verdict = bb == wb ? "same answer" : $"WRONG: window says {wb}, the true answer is {bb}";
                    Console.WriteLine($"{mode} n={n} K={k}: try every start {bs} steps, window {ws} steps, {verdict}");
                }
            }
    }
}
