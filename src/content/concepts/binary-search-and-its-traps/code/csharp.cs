// Binary search, counted in probes (one probe = one look at an item), never in time.
// Look for: halving needs about log2 n probes where a scan needs up to n; the textbook "find any match" version returns
// SOME copy of a duplicated value, not the first; the "lo = mid" off-by-one hangs only on some inputs; a 32-bit
// "(lo + hi) / 2" goes negative once the range is big; and the same halving works on an answer space, no array needed.
// The list is never built: item i of the sorted list is (i / run) * 2 + 1, so every value appears `run` times (odd values only).
using System;

public static class Program
{
    const int Cap = 64; // the buggy search is stopped after this many probes, so the program still ends

    static int At(int i, int run) => (i / run) * 2 + 1;
    static int FirstIndex(int v, int run) => ((v - 1) / 2) * run;

    // Scans from the left and stops at the first match, so it also finds the first occurrence.
    static (int, int) Linear(int n, int run, int t)
    {
        for (int i = 0; i < n; i++) if (At(i, run) == t) return (i + 1, i);
        return (n, -1);
    }

    // Textbook version: stop at the first probe that hits the target.
    static (int, int) BinaryAny(int n, int run, int t)
    {
        int lo = 0, hi = n - 1, probes = 0;
        while (lo <= hi)
        {
            int mid = lo + (hi - lo) / 2;
            probes++;
            int v = At(mid, run);
            if (v == t) return (probes, mid);
            if (v < t) lo = mid + 1; else hi = mid - 1;
        }
        return (probes, -1);
    }

    // Half-open range [lo, hi): keeps halving until it finds the first position whose value is >= t, then checks it (one more probe).
    static (int, int) LowerBound(int n, int run, int t)
    {
        int lo = 0, hi = n, probes = 0;
        while (lo < hi)
        {
            int mid = lo + (hi - lo) / 2;
            probes++;
            if (At(mid, run) < t) lo = mid + 1; else hi = mid;
        }
        probes++;
        return lo < n && At(lo, run) == t ? (probes, lo) : (probes, -1);
    }

    // "lo = mid" instead of "lo = mid + 1": when lo and hi are neighbours, mid == lo and nothing changes. Returns (probes, stuck).
    static (int, bool) Buggy(int n, int run, int t)
    {
        int lo = 0, hi = n - 1, probes = 0;
        while (lo < hi && probes < Cap)
        {
            int mid = lo + (hi - lo) / 2;
            probes++;
            if (At(mid, run) < t) lo = mid; else hi = mid;
        }
        return (probes, lo < hi);
    }

    static int Weight(int i) => 1 + (i * 37 + 11) % 20;

    static int DaysNeeded(int n, int cap)
    {
        int days = 1, load = 0;
        for (int i = 0; i < n; i++)
        {
            int w = Weight(i);
            if (load + w > cap) { days++; load = 0; }
            load += w;
        }
        return days;
    }

    public static void Main()
    {
        Console.WriteLine("-- probes to find a target in a sorted list of n items, each value repeated `run` times");
        foreach (int run in new[] { 1, 4 })
        {
            foreach (int n in new[] { 10, 1000, 1000000 })
            {
                foreach (var (name, t) in new[] { ("first", At(0, run)), ("last", At(n - 1, run)), ("middle", At(n / 2, run)), ("missing", 2) })
                {
                    var (lc, lp) = Linear(n, run, t);
                    var (bc, bp) = BinaryAny(n, run, t);
                    var (oc, op) = LowerBound(n, run, t);
                    var (gc, stuck) = Buggy(n, run, t);
                    int first = lp >= 0 ? FirstIndex(t, run) : -1;
                    string ok = bp < 0 ? "not found" : bp == first ? "first copy" : "a later copy";
                    string g = stuck ? $"stuck, gave up at {gc} probes" : $"{gc} probes";
                    Console.WriteLine($"run={run} n={n} {name}: linear {lc}, binary-any {bc} (index {bp}, {ok}), lower-bound {oc} (index {op}), lo=mid bug: {g}");
                }
            }
        }

        Console.WriteLine("-- the midpoint in 32-bit signed integers");
        foreach (var (lo, hi) in new[] { (1000000000, 1100000000), (1500000000, 2000000000), (2000000000, 2100000000) })
        {
            int s = unchecked(lo + hi); // an int holds 32 bits: the sum wraps around
            Console.WriteLine($"lo={lo} hi={hi}: (lo + hi) is {s}, naive mid {s / 2}, safe mid {lo + (hi - lo) / 2}");
        }

        Console.WriteLine("-- searching an answer space: the smallest ship capacity that moves n packages, in order, within D days");
        foreach (int n in new[] { 100, 1000 })
        {
            foreach (int d in new[] { 3, 10 })
            {
                int heaviest = 0, total = 0;
                for (int i = 0; i < n; i++) { heaviest = Math.Max(heaviest, Weight(i)); total += Weight(i); }
                int lo = heaviest, hi = total, probes = 0;
                while (lo < hi)
                {
                    int mid = lo + (hi - lo) / 2;
                    probes++;
                    if (DaysNeeded(n, mid) <= d) hi = mid; else lo = mid + 1;
                }
                int tries = lo - heaviest + 1;
                Console.WriteLine($"n={n} days={d}: capacity {lo} (searched {heaviest} to {total}), binary {probes} checks = {probes * n} steps, counting up from {heaviest}: {tries} checks = {tries * n} steps");
            }
        }
    }
}
