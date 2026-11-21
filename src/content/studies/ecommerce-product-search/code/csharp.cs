// Product search for a store, four hours: how price and stock changes reach the search index, how the index is
// sharded, and how results are ranked. 2,000 sample listings stand for a catalog of 50 million (each sample listing
// is 25,000 real ones), so counts of changes are scaled up while shares and ranks are measured on the sample.
// Every rate and cost below is an assumption of the model, not a measurement. Everything is an integer, so the output never changes.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const int EndMin = 240, FromMin = 60;           // minutes simulated; shoppers are measured from minute 60 on
    const int N = 2000, Scale = 25000;              // sample listings, and real listings each one stands for
    const int QueriesPerMin = 30, Cand = 40, Top = 10; // sample searches a minute, candidates per search, results shown
    const long PricePpm = 2400, CountPpm = 3000, OutPpm = 1000, BackPpm = 10000; // per listing per minute, parts per million; busy listings change more
    const int StormFrom = 120, StormTo = 180, StormX = 3; // a flash sale reprices items three times as often
    const long NewPerMin = 6000;                    // new listings and text edits a minute, in the real catalog
    const long DocsPerShard = 1400;                 // whole documents one shard copy can write a second, at a long refresh interval
    const long IndexS = 1, SideS = 1;               // seconds to analyse and write a document; to write the side store
    const long Qps = 20000, Cores = 32;             // searches a second at peak; cores in each search node
    const long WUs = 8000, FUs = 1000, FetchUs = 3000, SideUs = 4000; // microseconds: whole-index work, fixed work per shard, merge and fetch, side lookup
    const long SalesCap = 30, NewBoost = 25;        // the tuned mix: sales can add at most 30 points, a new listing gets 25
    const long IdxShare = 50;                       // share of a node's CPU that indexing may take
    static readonly int[] Disc = { 1000, 631, 500, 431, 387, 356, 333, 315, 301, 289 }; // 1000 / log2(position + 1)

    // ln(100 x shards) x 100: the 99th percentile of the slowest of n shards
    static long Tail(int shards) => shards switch { 4 => 599, 8 => 668, 16 => 738, _ => 807 };

    static long seed;
    static int Rnd(int n) { seed = (seed * 48271) % 2147483647; return (int)(seed % n); }
    static int Cube(int x) => (int)(((long)x * x * x) / 10000000); // 0 to 99, most listings near 0: a few best sellers

    class Change { public int M; public long Te; public int I; public string Kind = ""; public long Ve; public int Seq; }
    class Judge { public int T, S, G; public bool Fresh, Oos; }

    // The score a ranking mix gives a listing from its text score t, its sales score s and whether it is new.
    static long Key(string mix, int t, int s, bool fresh) =>
        mix == "text" ? t : mix == "tuned" ? 2L * t + Math.Min(s, SalesCap) + (fresh ? NewBoost : 0) : 2L * t + s;
    static bool Filters(string mix) => mix != "text" && mix != "sales";

    static void Catalog(out int[] sales, out bool[] oos)
    {
        seed = 11;
        sales = new int[N]; oos = new bool[N];
        for (int i = 0; i < N; i++) { int x = Rnd(1000); sales[i] = i % 10 == 3 ? 0 : Cube(x); } // every tenth listing is new, with no sales yet
        for (int i = 0; i < N; i++) oos[i] = Rnd(100) < 2 + sales[i] / 5;
    }

    // The stream of changes to the sample listings: price changes, stock counts going down, sell-outs and restocks.
    static List<Change> Changes(int[] sales, bool[] startOos, bool storm, int[] perMin)
    {
        seed = 23;
        var oos = (bool[])startOos.Clone();
        var ev = new List<Change>();
        for (int m = 0; m < EndMin; m++)
        {
            long x = storm && m >= StormFrom && m < StormTo ? StormX : 1;
            for (int i = 0; i < N; i++)
            {
                long r = Rnd(1000000), w = 10 + sales[i];
                long price = PricePpm * w * x / 35, count = CountPpm * w / 35, outp = OutPpm * w / 35;
                string kind = "";
                if (oos[i]) { if (r < BackPpm) kind = "back"; else if (r < BackPpm + price) kind = "price"; }
                else if (r < price) kind = "price";
                else if (r < price + count) kind = "count";
                else if (r < price + count + outp) kind = "out";
                if (kind == "") continue;
                if (kind == "out") oos[i] = true;
                if (kind == "back") oos[i] = false;
                ev.Add(new Change { M = m, Te = m * 60 + Rnd(59), I = i, Kind = kind, Seq = ev.Count });
                perMin[m]++;
            }
        }
        return ev;
    }

    // 12 broad "head" queries and 12 specific "tail" ones, 30 candidates each, graded 0 to 3.
    // Head queries: many listings match about equally, and what shoppers buy is a good signal. Tail queries: a few
    // listings match exactly (two of them brand new) and some best sellers match only loosely.
    static List<(bool Head, List<Judge> Cands)> Judged()
    {
        seed = 4242;
        var set = new List<(bool, List<Judge>)>();
        for (int q = 0; q < 24; q++)
        {
            bool head = q < 12;
            var cands = new List<Judge>();
            for (int j = 0; j < 30; j++)
            {
                bool fresh = head ? j % 15 == 7 : j == 1 || j == 2;
                int s = fresh ? 0 : Cube(Rnd(1000)), t, g;
                if (head)
                {
                    t = 60 + Rnd(36);
                    int quality = t + s / 2 + Rnd(21) - 10;
                    g = quality >= 115 ? 3 : quality >= 100 ? 2 : quality >= 85 ? 1 : 0;
                }
                else
                {
                    t = j < 3 ? 85 + Rnd(16) : j < 9 ? 40 + Rnd(21) : 20 + Rnd(51);
                    if (j >= 3 && j < 9) s = 80 + Rnd(20);
                    g = t >= 85 ? 3 : t >= 70 ? 2 : t >= 50 ? 1 : 0;
                }
                cands.Add(new Judge { T = t, S = s, G = g, Fresh = fresh, Oos = Rnd(100) < 2 + s / 5 });
            }
            set.Add((head, cands));
        }
        return set;
    }

    static void Relevance(string mix, out long head, out long tail, out long all)
    {
        head = tail = 0;
        foreach (var (isHead, cands) in Judged())
        {
            long Gain(Judge c) => c.Oos ? 0 : (1L << c.G) - 1; // a result nobody can buy earns nothing
            long Dcg(List<Judge> list) { long a = 0; for (int p = 0; p < Math.Min(Top, list.Count); p++) a += Gain(list[p]) * Disc[p]; return a; }
            var pool = Filters(mix) ? cands.Where(c => !c.Oos).ToList() : cands;
            var ranked = pool.Select((c, k) => (c, k)).ToList();
            ranked.Sort((a, b) => { long d = Key(mix, b.c.T, b.c.S, b.c.Fresh) - Key(mix, a.c.T, a.c.S, a.c.Fresh); return d != 0 ? (d < 0 ? -1 : 1) : a.k.CompareTo(b.k); });
            var ideal = cands.OrderByDescending(Gain).ToList();
            long score = Dcg(ranked.Select(x => x.c).ToList()) * 100 / Math.Max(1, Dcg(ideal));
            if (isHead) head += score; else tail += score;
        }
        all = (head + tail) / 24; head /= 12; tail /= 12;
    }

    static string Tenths(long n) => $"{n / 10}.{n % 10}";

    static void Run(string name, string path, int refresh, int shards, int replicas, string mix, bool storm)
    {
        Catalog(out var sales, out var startOos);
        var perMin = new int[EndMin];
        var ev = Changes(sales, startOos, storm, perMin);
        long copies = 1 + replicas;
        long cap = shards * DocsPerShard * (refresh + 3) / (refresh + 6); // whole documents a second the shards can write, one copy each
        var busy = new long[EndMin]; var done = new long[EndMin]; var lag = new long[EndMin];
        var batches = new List<(long Start, long End)>();
        if (path == "batch")
        {
            // every hour all listings changed since the last export are re-indexed in one go, and the new index opens when that ends
            long prevEnd = 0, exported = -1;
            for (int k = 1; k <= 4; k++)
            {
                long start = Math.Max(3600L * k, prevEnd);
                var dirty = new HashSet<int>();
                foreach (var e in ev) if (e.Te > exported && e.Te <= start) dirty.Add(e.I);
                long total = dirty.Count * (long)Scale + NewPerMin * 60, end = start + (total + cap - 1) / cap;
                foreach (var e in ev) if (e.Te > exported && e.Te <= start) e.Ve = end;
                batches.Add((start, end));
                exported = start; prevEnd = end;
            }
            for (int m = 0; m < EndMin; m++)
            {
                long secs = 0;
                foreach (var b in batches) secs += Math.Max(0, Math.Min(b.End, m * 60 + 60) - Math.Max(b.Start, m * 60));
                busy[m] = secs * 100 / 60; done[m] = secs * cap;
            }
        }
        else
        {
            // a queue in front of the indexer: changes wait when they arrive faster than the shards can write
            long backlog = 0, room = cap * 60;
            var arrivals = perMin.Select(n => (path == "nrt" ? n * (long)Scale : 0) + NewPerMin).ToArray();
            var raw = new List<long>();
            for (int m = 0; m < EndMin; m++)
            {
                long take = Math.Min(backlog + arrivals[m], room);
                raw.Add(Math.Min(100, (backlog + arrivals[m]) * 100 / room));
                long sum = 0; // searches feel indexing over minutes, not seconds: the load is the average of the last ten minutes
                for (int k = Math.Max(0, m - 9); k <= m; k++) sum += raw[k];
                busy[m] = sum / (m - Math.Max(0, m - 9) + 1);
                done[m] = take; backlog = backlog + arrivals[m] - take; lag[m] = (backlog + cap - 1) / cap;
            }
            var last = new long[N]; // one listing's changes stay in order
            foreach (var e in ev)
            {
                long ve = path == "side" ? e.Te + SideS : (e.Te + IndexS + lag[e.M] + refresh - 1) / refresh * refresh;
                ve = Math.Max(ve, last[e.I]); last[e.I] = ve; e.Ve = ve;
            }
        }
        // how long a new listing takes to become searchable (60 listings created through the window); new listings always go through the index
        long waited = 0;
        for (int k = 0; k < 60; k++)
        {
            long te = 3600 + k * 170 + (k * 37) % 60; int m = (int)(te / 60);
            long ve = path == "batch" ? batches.First(b => b.Start >= te).End : (te + IndexS + lag[m] + refresh - 1) / refresh * refresh;
            waited += ve - te;
        }
        // the shoppers: what they see against what is true at the end of each minute
        var truth = (bool[])startOos.Clone(); var view = (bool[])startOos.Clone(); var priceVe = new long[N]; var pend = new List<Change>();
        long shown = 0, badPrice = 0, badStock = 0, badAny = 0; int at = 0;
        var perm = Enumerable.Range(0, N).ToArray();
        seed = 99;
        for (int m = 0; m < EndMin; m++)
        {
            for (; at < ev.Count && ev[at].M == m; at++)
            {
                var e = ev[at];
                if (e.Kind == "out") truth[e.I] = true;
                if (e.Kind == "back") truth[e.I] = false;
                if (e.Kind == "price") priceVe[e.I] = e.Ve;
                if (e.Kind == "out" || e.Kind == "back") pend.Add(e);
            }
            long tq = m * 60 + 59;
            pend.Sort((a, b) => a.Ve != b.Ve ? a.Ve.CompareTo(b.Ve) : a.Seq.CompareTo(b.Seq));
            while (pend.Count > 0 && pend[0].Ve <= tq) { var e = pend[0]; pend.RemoveAt(0); view[e.I] = e.Kind == "out"; }
            if (m < FromMin) continue;
            for (int q = 0; q < QueriesPerMin; q++)
            {
                var list = new List<(int I, int T, int J)>();
                for (int j = 0; j < Cand; j++) { int k = j + Rnd(N - j); (perm[j], perm[k]) = (perm[k], perm[j]); list.Add((perm[j], Rnd(100), j)); }
                var pool = Filters(mix) ? list.Where(c => !view[c.I]).ToList() : list; // the filter trusts what the index (or side store) says
                pool.Sort((a, b) => { long d = Key(mix, b.T, sales[b.I], b.I % 10 == 3) - Key(mix, a.T, sales[a.I], a.I % 10 == 3); return d != 0 ? (d < 0 ? -1 : 1) : a.J.CompareTo(b.J); });
                foreach (var c in pool.Take(Top))
                {
                    bool stale = priceVe[c.I] > tq, gone = truth[c.I];
                    shown++; if (stale) badPrice++; if (gone) badStock++; if (stale || gone) badAny++;
                }
            }
        }
        // the slowest minute for searches, and how many documents the shards re-index
        long worst = 0, peakDocs = 0, sumDocs = 0;
        long sUs = ((WUs / shards) + FUs) * (100 + 40 / refresh) / 100;
        for (int m = FromMin; m < EndMin; m++)
        {
            long rho = Math.Min(98, Qps * sUs * 100 / (1000000 * copies * Cores) + IdxShare * busy[m] / 100);
            long mean = sUs + sUs * rho * rho / (100 * (100 - rho));
            long p99 = mean * Tail(shards) / 100 + FetchUs + (path == "side" ? SideUs : 0);
            worst = Math.Max(worst, p99);
            peakDocs = Math.Max(peakDocs, done[m] / 60); sumDocs += done[m];
        }
        Relevance(mix, out var head, out var tail, out var all);
        string behind = path == "batch" ? "up to an hour" : $"{lag[EndMin - 1]} s";
        Console.WriteLine($"-- {name}");
        Console.WriteLine($"  results showing a stale price or no stock: {Tenths(badAny * 1000 / shown)}% (stale price {Tenths(badPrice * 1000 / shown)}%, out of stock {Tenths(badStock * 1000 / shown)}%) of {shown}");
        Console.WriteLine($"  slowest minute p99 {worst / 1000} ms; documents re-indexed per second: peak {peakDocs * copies}, average {sumDocs * copies / ((EndMin - FromMin) * 60)}, capacity {cap * copies}; index behind by {behind} at the end");
        Console.WriteLine($"  new listing searchable after {waited / 60} s; relevance {all} (head {head}, tail {tail})");
    }

    public static void Main()
    {
        Run("hourly batch", "batch", 5, 8, 2, "text", false);
        Run("near real time, all fields", "nrt", 5, 8, 2, "text", false);
        Run("near real time, all fields, 1 s refresh, flash sale", "nrt", 1, 8, 2, "text", true);
        Run("near real time, price and stock on the side", "side", 1, 8, 2, "text", true);
        Run("side lookups, text and sales", "side", 5, 8, 2, "sales", false);
        Run("side lookups, text, sales and stock filter", "side", 5, 8, 2, "stock", false);
        Run("hourly batch, text, sales and stock filter", "batch", 5, 8, 2, "stock", false);
        Run("side lookups, capped sales, new boost and stock filter", "side", 5, 8, 2, "tuned", false);
    }
}
