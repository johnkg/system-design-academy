// Greedy algorithms: where "take the best-looking choice now" is provably right, and where it quietly is not.
// Operations are counted with an explicit counter (comparisons and candidate checks), not time.
// Four experiments, all deterministic:
//   1. interval scheduling (most non-overlapping jobs): sorting by earliest FINISH is optimal; two other "sensible" rules are not
//   2. weighted interval scheduling: the same earliest-finish rule is now wrong; dynamic programming is right
//   3. coin change: greedy is optimal for 1, 5, 10, 25 and wrong for 1, 3, 4, and for 1, 7, 10; but it is far cheaper
//   4. knapsack: greedy by value per weight is a heuristic with no guarantee, close here but not exact
// Look for: the gap between what a greedy rule picks and the true optimum, and the price of finding the optimum.
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

    // Merge sort over job indices by a key, counting every key comparison (stable: equal keys keep their order).
    static List<int> SortBy(long[] keys, ref long counter)
    {
        long c = counter;
        List<int> MergeSort(List<int> idx)
        {
            if (idx.Count <= 1) return idx;
            int mid = idx.Count / 2;
            var left = MergeSort(idx.GetRange(0, mid));
            var right = MergeSort(idx.GetRange(mid, idx.Count - mid));
            var o = new List<int>();
            int i = 0, j = 0;
            while (i < left.Count && j < right.Count)
            {
                c++;
                if (keys[left[i]] <= keys[right[j]]) o.Add(left[i++]);
                else o.Add(right[j++]);
            }
            o.AddRange(left.GetRange(i, left.Count - i));
            o.AddRange(right.GetRange(j, right.Count - j));
            return o;
        }
        var result = MergeSort(Enumerable.Range(0, keys.Length).ToList());
        counter = c;
        return result;
    }

    static List<(int s, int e)> MakeJobs(int n)
    {
        var rng = new Rng(777);
        var jobs = new List<(int, int)>();
        for (int i = 0; i < n; i++)
        {
            int s = (int)(rng.Next() % (4 * n));
            int length = 1 + (int)(rng.Next() % 40);
            jobs.Add((s, s + length)); // half-open interval [start, end)
        }
        return jobs;
    }

    static bool Overlap((int s, int e) a, (int s, int e) b) => a.s < b.e && b.s < a.e;

    // Greedy: sort by the rule's key, then take every job that does not overlap a job already taken.
    // For "finish" and "start" the jobs arrive in time order, so comparing with the last job taken is enough;
    // "shortest" arrives in any time order, so each job is compared with every job taken so far.
    static (int taken, long ops) Schedule(List<(int s, int e)> jobs, string rule)
    {
        var keys = jobs.Select(j => (long)(rule == "finish" ? j.e : rule == "start" ? j.s : j.e - j.s)).ToArray();
        long counter = 0;
        var order = SortBy(keys, ref counter);
        var chosen = new List<int>();
        int lastEnd = -1;
        foreach (int i in order)
        {
            if (rule == "shortest")
            {
                bool ok = true;
                foreach (int j in chosen)
                {
                    counter++;
                    if (Overlap(jobs[i], jobs[j])) { ok = false; break; }
                }
                if (ok) chosen.Add(i);
            }
            else
            {
                counter++;
                if (jobs[i].s >= lastEnd) { chosen.Add(i); lastEnd = jobs[i].e; }
            }
        }
        return (chosen.Count, counter);
    }

    static int BruteForce(List<(int s, int e)> jobs)
    {
        int n = jobs.Count, best = 0;
        for (int mask = 0; mask < (1 << n); mask++)
        {
            var chosen = new List<(int s, int e)>();
            for (int i = 0; i < n; i++) if (((mask >> i) & 1) == 1) chosen.Add(jobs[i]);
            if (chosen.Count <= best) continue;
            chosen.Sort((a, b) => a.s != b.s ? a.s.CompareTo(b.s) : a.e.CompareTo(b.e));
            bool ok = true;
            for (int k = 0; k < chosen.Count - 1; k++) if (chosen[k].e > chosen[k + 1].s) { ok = false; break; }
            if (ok) best = chosen.Count;
        }
        return best;
    }

    // Weighted jobs: maximise total weight. Greedy rules against dynamic programming over jobs sorted by finish time.
    static (long a, long b, long opt, long opsB, long opsDp) Weighted(int n)
    {
        var jobs = MakeJobs(n);
        var rng = new Rng(999);
        var w = new List<int>();
        for (int i = 0; i < n; i++) w.Add(1 + (int)(rng.Next() % 20));
        // greedy A: earliest finish, weights ignored
        long counter = 0;
        var order = SortBy(jobs.Select(j => (long)j.e).ToArray(), ref counter);
        int last = -1;
        long totalA = 0;
        foreach (int i in order)
            if (jobs[i].s >= last) { totalA += w[i]; last = jobs[i].e; }
        // greedy B: heaviest first, skip any job that overlaps one already taken
        long opsB = 0;
        var orderB = SortBy(w.Select(x => (long)(1000 - x)).ToArray(), ref opsB);
        var chosen = new List<int>();
        long totalB = 0;
        foreach (int i in orderB)
        {
            bool ok = true;
            foreach (int j in chosen)
            {
                opsB++;
                if (Overlap(jobs[i], jobs[j])) { ok = false; break; }
            }
            if (ok) { chosen.Add(i); totalB += w[i]; }
        }
        // dynamic programming: best[k] = best total using the first k jobs in finish order
        long opsDp = counter;
        var ends = order.Select(i => jobs[i].e).ToList();
        var best = new long[n + 1];
        for (int k = 1; k <= n; k++)
        {
            int s = jobs[order[k - 1]].s;
            int lo = 0, hi = k - 1; // how many earlier jobs (in finish order) end at or before this job's start
            while (lo < hi)
            {
                opsDp++;
                int mid = (lo + hi) / 2;
                if (ends[mid] <= s) lo = mid + 1; else hi = mid;
            }
            opsDp++;
            best[k] = Math.Max(best[k - 1], w[order[k - 1]] + best[lo]);
        }
        return (totalA, totalB, best[n], opsB, opsDp);
    }

    static (int used, int ops) GreedyCoins(int[] coins, int amount)
    {
        int used = 0, ops = 0;
        foreach (int c in coins.OrderByDescending(x => x))
        {
            ops++;
            used += amount / c;
            amount %= c;
        }
        return (amount == 0 ? used : -1, ops);
    }

    static (int[] table, long ops) BestCoins(int[] coins, int upto)
    {
        var table = new int[upto + 1];
        long ops = 0;
        for (int a = 1; a <= upto; a++)
        {
            int best = 1_000_000_000;
            foreach (int c in coins)
            {
                ops++;
                if (c <= a && table[a - c] + 1 < best) best = table[a - c] + 1;
            }
            table[a] = best;
        }
        return (table, ops);
    }

    // Knapsack, 0/1: items have an integer weight and value; greedy takes items by value per weight while they fit.
    static (int cap, int greedy, int opt, long ops, long dpOps) Knapsack(int n)
    {
        var items = new List<(int w, int v)>();
        for (int i = 0; i < n; i++) items.Add((5 + (i * 7) % 23, 10 + (i * 11) % 37));
        int cap = items.Sum(x => x.w) / 3;
        long ops = 0;
        var order = Enumerable.Range(0, n).ToArray();
        // insertion sort by value/weight descending using cross-multiplication (integers only), counted
        for (int i = 1; i < n; i++)
        {
            int j = i;
            while (j > 0)
            {
                ops++;
                var a = items[order[j - 1]]; var b = items[order[j]];
                if (a.v * b.w < b.v * a.w)
                {
                    (order[j - 1], order[j]) = (order[j], order[j - 1]);
                    j--;
                }
                else break;
            }
        }
        int room = cap, total = 0;
        foreach (int i in order)
        {
            ops++;
            if (items[i].w <= room) { room -= items[i].w; total += items[i].v; }
        }
        var best = new int[cap + 1];
        long dpOps = 0;
        foreach (var (w, v) in items)
            for (int c = cap; c >= w; c--)
            {
                dpOps++;
                best[c] = Math.Max(best[c], best[c - w] + v);
            }
        return (cap, total, best[cap], ops, dpOps);
    }

    public static void Main()
    {
        Console.WriteLine("-- interval scheduling: most non-overlapping jobs (jobs chosen, operations)");
        foreach (int n in new[] { 10, 100, 1000 })
        {
            var jobs = MakeJobs(n);
            var f = Schedule(jobs, "finish"); var s = Schedule(jobs, "start"); var sh = Schedule(jobs, "shortest");
            Console.WriteLine($"  n={n}: earliest finish {f.taken} ({f.ops} ops), earliest start {s.taken} ({s.ops} ops), shortest first {sh.taken} ({sh.ops} ops)");
        }
        var small = MakeJobs(14);
        Console.WriteLine($"  brute force over 2^14 = {1 << 14} subsets of 14 jobs: best {BruteForce(small)}, earliest finish {Schedule(small, "finish").taken}, earliest start {Schedule(small, "start").taken}, shortest first {Schedule(small, "shortest").taken}");

        Console.WriteLine("-- weighted interval scheduling: total weight (greedy rules against dynamic programming)");
        foreach (int n in new[] { 10, 100, 1000 })
        {
            var r = Weighted(n);
            Console.WriteLine($"  n={n}: earliest finish ignoring weights {r.a}, heaviest first {r.b} ({r.opsB} ops after sorting), optimal {r.opt} ({r.opsDp} ops)");
        }
        Console.WriteLine("  tiny case: jobs [0,10) weight 10, [0,5) weight 1, [5,10) weight 1: earliest finish takes the two small jobs for weight 2, the optimum is 10");

        Console.WriteLine("-- coin change: greedy against the optimum for every amount from 1 to 1000");
        foreach (var coins in new[] { new[] { 1, 5, 10, 25 }, new[] { 1, 3, 4 }, new[] { 1, 7, 10 }, new[] { 1, 5, 12 }, new[] { 1, 5, 10, 20, 25 } })
        {
            var (table, _) = BestCoins(coins, 1000);
            var bad = new List<int>();
            for (int a = 1; a <= 1000; a++) if (GreedyCoins(coins, a).used != table[a]) bad.Add(a);
            int worst = 0;
            foreach (int a in bad) worst = Math.Max(worst, GreedyCoins(coins, a).used - table[a]);
            Console.WriteLine($"  coins {{{string.Join(",", coins)}}}: greedy wrong for {bad.Count} of 1000 amounts, first at {(bad.Count > 0 ? bad[0].ToString() : "none")}, worst excess {worst} coins");
        }
        Console.WriteLine("  the price of the optimum: amount 100000 with coins {1,5,10,25}");
        var g = GreedyCoins(new[] { 1, 5, 10, 25 }, 100000);
        var dp = BestCoins(new[] { 1, 5, 10, 25 }, 100000);
        Console.WriteLine($"  greedy {g.used} coins in {g.ops} steps, table method {dp.ops} steps");

        Console.WriteLine("-- 0/1 knapsack: greedy by value per weight against the optimum (capacity is a third of the total weight)");
        foreach (int n in new[] { 10, 20, 40, 80 })
        {
            var k = Knapsack(n);
            Console.WriteLine($"  n={n}: capacity {k.cap}, greedy value {k.greedy}, optimal {k.opt}, greedy {k.ops} ops, table method {k.dpOps} ops");
        }
    }
}
