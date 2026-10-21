// A mini query planner: estimate the cost of three join methods from row counts, pick the cheapest,
// then run all three for real and compare the estimate with what happened. Integer maths only, so the output is exact.
using System;
using System.Collections.Generic;
using System.Linq;

class Planner
{
    const long SEQ = 1000, TUPLE = 10, CMP = 3, HASH = 5, SETUP = 1000; // cost units: one sequential page read = 1000
    const long CUST_PER_PAGE = 40, ORD_PER_PAGE = 100;
    const long SEED = 7, NL_ONE_IN = 10; // one customer in 10 lives in NL
    const long ROW_KEY = 1000; // a result row packs both ids: order_id * 1000 + customer_id
    const long STALE_SHRINK = 20; // stale statistics were taken when the tables were 20x smaller
    const long LARGE_CUST = 1000, LARGE_ORD = 20000;
    const long WRONG_PLAN_FACTOR = 5; // the stale plan must cost at least this many times the best one
    static readonly string[] Methods = { "nested loop", "hash join", "merge join" };

    static (List<(long id, string country)>, List<(long id, long cid)>) MakeTables(long nCust, long nOrd, bool presorted)
    {
        long state = SEED;
        long Rnd(long n) { state = (state * 1664525 + 1013904223) % 4294967296; return (state / 256) % n; } // tiny LCG: same rows in every language
        var customers = new List<(long, string)>();
        for (long i = 1; i <= nCust; i++) customers.Add((i, Rnd(NL_ONE_IN) == 0 ? "NL" : "US"));
        var orders = new List<(long, long)>();
        for (long i = 1; i <= nOrd; i++) { long a = Rnd(nCust), b = Rnd(nCust); orders.Add((i, 1 + Math.Min(a, b))); } // skewed: low ids order more
        if (presorted) orders = orders.OrderBy(o => o.Item2).ThenBy(o => o.Item1).ToList(); // like a table clustered on customer_id
        return (customers, orders);
    }

    static long Pages(long rows, long perPage) => (rows + perPage - 1) / perPage;
    static long Log2Ceil(long n) => n > 1 ? 64 - System.Numerics.BitOperations.LeadingZeroCount((ulong)(n - 1)) : 0;

    // Cost from statistics only: st = (customer rows, order rows, distinct customer ids in orders, filtered customers).
    static long Estimate(string method, long[] st, long pCust, long pOrd, bool presorted)
    {
        long nCust = st[0], nOrd = st[1], ndv = st[2], k = st[3];
        long m = k * nOrd / ndv; // estimated join output
        long b = pCust * SEQ + nCust * TUPLE;
        if (method == "nested loop") return b + pOrd * SEQ + nOrd * TUPLE + k * nOrd * CMP;
        if (method == "hash join") return b + pOrd * SEQ + nOrd * TUPLE + (k + nOrd) * HASH + m * CMP + SETUP;
        return b + pOrd * SEQ + (nOrd + k) * TUPLE + (k + nOrd + (presorted ? 0 : nOrd * Log2Ceil(nOrd))) * CMP; // merge: sort orders first unless already sorted
    }

    static List<(long cid, long oid)> MergeSort(List<(long cid, long oid)> rows, long[] c)
    {
        if (rows.Count <= 1) return rows;
        int mid = rows.Count / 2;
        var left = MergeSort(rows.GetRange(0, mid), c); var right = MergeSort(rows.GetRange(mid, rows.Count - mid), c);
        var res = new List<(long, long)>(); int i = 0, j = 0;
        while (i < left.Count && j < right.Count)
        {
            c[0]++;
            if (right[j].cid < left[i].cid) res.Add(right[j++]); else res.Add(left[i++]);
        }
        res.AddRange(left.Skip(i)); res.AddRange(right.Skip(j));
        return res;
    }

    // Execute the join and count the work. Returns (sorted result rows, cost in units, comparisons).
    static (List<long>, long, long) Run(string method, List<(long id, string country)> customers, List<(long id, long cid)> orders, string country, bool presorted)
    {
        long seq = Pages(customers.Count, CUST_PER_PAGE) + Pages(orders.Count, ORD_PER_PAGE), tuples = customers.Count + orders.Count, cmp = 0, hash = 0, setup = 0;
        var outer = customers.Where(c => c.country == country).Select(c => c.id).ToList();
        var o = new List<long>();
        if (method == "nested loop")
        {
            foreach (var cid in outer) foreach (var (oid, ocid) in orders) { cmp++; if (ocid == cid) o.Add(oid * ROW_KEY + cid); }
        }
        else if (method == "hash join")
        {
            setup = SETUP;
            var table = new HashSet<long>();
            foreach (var cid in outer) { hash++; table.Add(cid); }
            foreach (var (oid, ocid) in orders) { hash++; if (table.Contains(ocid)) { cmp++; o.Add(oid * ROW_KEY + ocid); } }
        }
        else
        {
            var c = new long[1];
            var ordered = orders.Select(r => (cid: r.cid, oid: r.id)).ToList();
            if (!presorted) ordered = MergeSort(ordered, c);
            cmp += c[0]; tuples += outer.Count;
            int i = 0, j = 0;
            while (i < outer.Count && j < ordered.Count)
            {
                cmp++;
                if (outer[i] < ordered[j].cid) i++;
                else if (outer[i] > ordered[j].cid) j++;
                else { o.Add(ordered[j].oid * ROW_KEY + outer[i]); j++; }
            }
        }
        o.Sort();
        return (o, seq * SEQ + tuples * TUPLE + cmp * CMP + hash * HASH + setup, cmp + hash);
    }

    static long Checksum(List<long> rows) { long h = 0; foreach (var v in rows) h = (h * 31 + v) % 1000003; return h; }
    static string Cheapest(Func<string, long> f) => Methods.Aggregate((a, b) => f(b) < f(a) ? b : a);

    static (string, string, long, long) PlanAndRun(string label, long nCust, long nOrd, bool stale, bool presorted = false)
    {
        var (customers, orders) = MakeTables(nCust, nOrd, presorted);
        long pC = Pages(nCust, CUST_PER_PAGE), pO = Pages(nOrd, ORD_PER_PAGE); // page counts always come from the file size
        long ndv = orders.Select(x => x.cid).Distinct().Count();
        long kReal = customers.Count(c => c.country == "NL");
        // fresh statistics are exact; stale ones are from when the tables were 20x smaller and NL was rare (0.2%)
        long[] st = stale ? new[] { Math.Max(1, nCust / STALE_SHRINK), Math.Max(1, nOrd / STALE_SHRINK), Math.Max(1, ndv / STALE_SHRINK), 1L } : new[] { nCust, nOrd, ndv, kReal };
        var est = new Dictionary<string, long>(); var runs = new Dictionary<string, (List<long> rows, long cost, long cmp)>();
        foreach (var m in Methods) { est[m] = Estimate(m, st, pC, pO, presorted); var r = Run(m, customers, orders, "NL", presorted); runs[m] = (r.Item1, r.Item2, r.Item3); }
        string pick = Cheapest(m => est[m]);
        if (!runs["nested loop"].rows.SequenceEqual(runs["hash join"].rows) || !runs["hash join"].rows.SequenceEqual(runs["merge join"].rows)) throw new Exception("methods disagree");
        string best = Cheapest(m => runs[m].cost);
        Console.WriteLine($"{label}: {nCust} customers, {nOrd} orders, filter matches {kReal} (planner expects {st[3]})");
        foreach (var m in Methods) Console.WriteLine($"  {m,-11} est {est[m],9}  actual {runs[m].cost,9}  compared {runs[m].cmp,8}");
        var rows = runs[pick].rows;
        Console.WriteLine($"  planner picks {pick}; cheapest in reality: {best}; {rows.Count} rows, checksum {Checksum(rows)}");
        return (pick, best, runs[pick].cost, runs[best].cost);
    }

    static void Expect(bool ok, string msg) { if (!ok) throw new Exception(msg); }

    static void Main()
    {
        var (pick, best, _, _) = PlanAndRun("tiny", 16, 60, false);
        Expect(pick == "nested loop" && best == "nested loop", "tiny: nested loop should win");
        (pick, best, _, _) = PlanAndRun("large", LARGE_CUST, LARGE_ORD, false);
        Expect(pick == "hash join" && best == "hash join", "large: hash join should win");
        var (stalePick, staleBest, got, ideal) = PlanAndRun("large, stale stats", LARGE_CUST, LARGE_ORD, true);
        Expect(stalePick == "nested loop" && staleBest == "hash join" && got > WRONG_PLAN_FACTOR * ideal, "stale statistics should pick the wrong method");
        (pick, best, _, _) = PlanAndRun("large, orders sorted by customer_id", LARGE_CUST, LARGE_ORD, false, true);
        Expect(pick == "merge join" && best == "merge join", "sorted input: merge join should win");
        Console.WriteLine($"stale statistics made the query cost {got / ideal}x more than necessary");
    }
}
