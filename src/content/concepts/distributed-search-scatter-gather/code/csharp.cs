// Scatter and gather: a coordinator sends a query to every shard, each shard returns its own top (from + size) results,
// and the coordinator merges them. The query is as slow as its slowest shard. 2,000 simulated queries with a seeded
// random generator, integer milliseconds, so the output never changes.
using System;
using System.Collections.Generic;

public static class Program
{
    const int Queries = 2000;
    const int BaseMs = 20;        // a shard answers in about this long when nothing goes wrong
    const int SlowPerMille = 5;   // chance (in 1,000) that one shard request is slow (0.5%)
    const int SlowMs = 200;       // how much longer a slow request takes
    const int BigShard = 3;       // with uneven shards, shard 0 holds this many times the data and takes this many times as long

    record Setup(int Shards = 8, int Replicas = 1, bool Hedge = false, int Spread = 10, int From = 0, int Size = 10, bool Uneven = false);
    record Result(int P50, int P99, int SlowTenths, int Moved, int Kept);

    static Func<int, int> MakeRandom(long seed)  // Park-Miller generator: small enough that every language computes it exactly
    {
        long x = seed;
        return n => { x = x * 48271 % 2147483647; return (int)(x % n); };
    }

    // One shard request: base time (more for a bigger shard), a random spread, a rare slow spike, and the cost of collecting from + size hits.
    static int ShardTime(Func<int, int> rand, int baseMs, int spread, int depth)
    {
        int t = baseMs + rand(spread + 1);
        if (rand(1000) < SlowPerMille) t += SlowMs;
        return t + depth / 100;
    }

    static Result Run(Setup c)
    {
        var rand = MakeRandom(12345);
        int depth = c.From + c.Size;
        int merge = 2 + c.Shards * depth / 1000;  // the coordinator merges shards x (from + size) hits
        var times = new List<int>();
        int slowQueries = 0;
        for (int q = 0; q < Queries; q++)
        {
            int worst = 0;
            bool hitSlow = false;
            for (int s = 0; s < c.Shards; s++)
            {
                int baseMs = c.Uneven && s == 0 ? BaseMs * BigShard : BaseMs;
                int a = ShardTime(rand, baseMs, c.Spread, depth);
                int b = ShardTime(rand, baseMs, c.Spread, depth);  // the second replica is always drawn, so settings are compared on the same luck
                int t = c.Hedge && c.Replicas >= 2 ? Math.Min(a, b) : a;
                if (t >= baseMs + SlowMs) hitSlow = true;
                worst = Math.Max(worst, t);
            }
            if (hitSlow) slowQueries++;
            times.Add(worst + merge);
        }
        times.Sort();
        return new Result(times[Queries * 50 / 100], times[Queries * 99 / 100], slowQueries * 1000 / Queries, c.Shards * depth, c.Size);
    }

    static Result Show(string name, Setup c)
    {
        var r = Run(c);
        Console.WriteLine($"{name}: p50 {r.P50} ms, p99 {r.P99} ms, {r.SlowTenths / 10}.{r.SlowTenths % 10}% of queries hit a slow shard, {r.Moved} documents sent to the coordinator for {r.Kept} shown");
        return r;
    }

    public static void Main()
    {
        var b = new Setup();
        Console.WriteLine("how the slowest shard decides the query (spread 10 ms, first page)");
        var one = Show("1 shard   ", b with { Shards = 1 });
        Show("8 shards  ", b);
        var wide = Show("32 shards ", b with { Shards = 32 });
        Console.WriteLine("send each request to two replicas and use the first answer");
        Show("8 shards, 2 replicas, hedged", b with { Replicas = 2, Hedge = true });
        var hedged = Show("32 shards, 2 replicas, hedged", b with { Shards = 32, Replicas = 2, Hedge = true });
        Console.WriteLine("deep pagination, 8 shards (size 10)");
        Show("from 0     ", b);
        Show("from 1000  ", b with { From = 1000 });
        var deep = Show("from 10000 ", b with { From = 10000 });
        Console.WriteLine("uneven shards: shard 0 holds 3 times the data");
        var uneven = Show("8 shards, one big shard", b with { Uneven = true });
        if (wide.P99 <= one.P99 || hedged.P99 >= wide.P99 || deep.Moved != 80080 || uneven.P50 <= 60) throw new Exception("impossible result");
    }
}
