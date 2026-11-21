// Space-time tradeoff: answer many range-sum queries over an array of n numbers in three ways, counting steps and memory cells.
//   recompute:   no extra memory, but every query adds up its whole range again.
//   prefix sums: one pass builds n + 1 running totals (n + 1 cells); every query is one subtraction.
//   full table:  the sum of every range stored in an n x n table (n * n cells); every query is one lookup.
// Each query asks for a range of half the array (n / 2 elements). Look for: the table's memory is quadratic, and a precomputation
// only pays off after enough queries (the break-even), and never against the prefix table here.
using System;
using System.Collections.Generic;

public static class Program
{
    const long BytesPerCell = 8; // typically 8 bytes for a 64-bit number in a compact array; boxed objects cost more

    record Cost(long Build, long PerQuery, long Cells);

    static Cost Costs(string technique, long n)
    {
        long half = n / 2;
        if (technique == "recompute") return new(0, half, 0);
        if (technique == "prefix") return new(n, 1, n + 1);
        return new(n * n, 1, n * n);
    }

    static long Total(string t, long n, long q) { var c = Costs(t, n); return c.Build + q * c.PerQuery; }

    // Smallest number of queries at which the technique's total is below recomputing every time (0 = never).
    static long BreakEven(string t, long n)
    {
        var c = Costs(t, n); var r = Costs("recompute", n);
        if (c.PerQuery >= r.PerQuery) return 0;
        long q = c.Build / (r.PerQuery - c.PerQuery) + 1;
        while (Total(t, n, q) >= Total("recompute", n, q)) q++;
        return q;
    }

    public static void Main()
    {
        Console.WriteLine("-- cost model: build steps, steps per query, memory cells");
        foreach (long n in new long[] { 100, 1000, 10000, 100000 })
            foreach (var t in new[] { "recompute", "prefix", "table" })
            {
                var c = Costs(t, n);
                Console.WriteLine($"n={n} {t}: build {c.Build}, per query {c.PerQuery}, memory {c.Cells} cells");
            }
        Console.WriteLine("-- total steps for q queries");
        foreach (var (n, q) in new[] { (1000L, 10L), (1000L, 1000L), (1000L, 100000L), (100000L, 1000L) })
            Console.WriteLine($"n={n} q={q}: recompute {Total("recompute", n, q)}, prefix {Total("prefix", n, q)}, table {Total("table", n, q)}");
        Console.WriteLine("-- queries needed before the precomputation beats recomputing");
        foreach (long n in new long[] { 100, 1000, 10000 }) Console.WriteLine($"n={n}: prefix {BreakEven("prefix", n)}, table {BreakEven("table", n)}");
        Console.WriteLine($"a table of 100000 x 100000 cells at {BytesPerCell} bytes each: {100000L * 100000L * BytesPerCell / 1000000000} GB");

        // The model is checked against real code at a small size: the three methods give the same answers, and the counters match.
        {
            int n = 50;
            var a = new long[n];
            for (int i = 0; i < n; i++) a[i] = (i * 7) % 13;
            var queries = new List<int>();
            long x = 99;
            for (int i = 0; i < 20; i++) { x = (x * 1103515245 + 12345) % 2147483648; queries.Add((int)(x % (n - n / 2 + 1))); }
            long stepsR = 0, answersR = 0;
            foreach (var s in queries) for (int i = s; i < s + n / 2; i++) { answersR += a[i]; stepsR++; }
            var prefix = new long[n + 1]; long stepsP = 0;
            for (int i = 0; i < n; i++) { prefix[i + 1] = prefix[i] + a[i]; stepsP++; }
            long answersP = 0;
            foreach (var s in queries) { answersP += prefix[s + n / 2] - prefix[s]; stepsP++; }
            var table = new long[n, n]; long stepsT = 0;
            for (int i = 0; i < n; i++) { long run = 0; for (int j = 0; j < n; j++) { if (j >= i) run += a[j]; table[i, j] = run; stepsT++; } }
            long answersT = 0;
            foreach (var s in queries) { answersT += table[s, s + n / 2 - 1]; stepsT++; }
            Console.WriteLine($"-- model against real code (n={n}, 20 queries): same answers {(answersR == answersP && answersP == answersT ? "true" : "false")}");
            Console.WriteLine($"steps counted: recompute {stepsR} (model {Total("recompute", n, 20)}), prefix {stepsP} (model {Total("prefix", n, 20)}), table {stepsT} (model {Total("table", n, 20)})");
        }

        // A cache with no eviction grows with the number of distinct keys; a cache with a cap stays bounded but gives up some hits.
        {
            int requests = 100000, keys = 50000, cap = 1000;
            long x = 12345; int hitsU = 0, hitsC = 0;
            var unbounded = new HashSet<long>(); var capped = new HashSet<long>(); var order = new Queue<long>();
            for (int i = 0; i < requests; i++)
            {
                x = (x * 1664525 + 1013904223) % 4294967296;
                long k = (x / 65536) % keys;
                if (unbounded.Contains(k)) hitsU++; else unbounded.Add(k);
                if (capped.Contains(k)) hitsC++;
                else { capped.Add(k); order.Enqueue(k); if (order.Count > cap) capped.Remove(order.Dequeue()); } // first in, first out
            }
            Console.WriteLine($"-- cache over {requests} requests for {keys} possible keys");
            Console.WriteLine($"no eviction: {unbounded.Count} entries, {hitsU} hits");
            Console.WriteLine($"capped at {cap} entries (first in, first out): {capped.Count} entries, {hitsC} hits");
        }
    }
}
