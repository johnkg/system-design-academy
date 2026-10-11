// A two-level CDN cache (edge PoPs in front of one regional shield) in C#:
// least-recently-used eviction, expiry by TTL, and the choice of joining a fetch that is already under way.
using System;
using System.Collections.Generic;
using System.Linq;

public class Entry { public long Ready, Expires, Used; }

public static class Cdn
{
    public const int Ttl = 20000, EdgeCap = 200, ShieldCap = 500, Pops = 4, Requests = 20000;
    public const int EdgeShield = 16, OriginTrip = 80, OriginWork = 30; // milliseconds: edge to shield and back, origin round trip, origin processing
}

public class Cache
{
    readonly int cap;
    public readonly Dictionary<int, Entry> Items = new();
    long tick;
    public int Hits, Joined, Misses;
    public Cache(int cap) { this.cap = cap; }

    // Returns how long the caller waits (ms) until the object is available at this level.
    public long Lookup(int key, long now, bool coalesce, Func<long> fetch)
    {
        if (Items.TryGetValue(key, out var e) && e.Expires > now)
        {
            if (e.Ready <= now) { e.Used = ++tick; Hits++; return 0; }          // fresh copy: a hit
            if (coalesce) { Joined++; return e.Ready - now; }                    // a fetch is under way: wait for it
        }
        Misses++;
        long wait = fetch();                                                      // expired, absent, or not joining: fetch again
        Items[key] = new Entry { Ready = now + wait, Expires = now + wait + Cdn.Ttl, Used = ++tick };
        while (Items.Count > cap)                                                 // evict the least recently used
        {
            int oldest = Items.MinBy(kv => kv.Value.Used).Key;
            Items.Remove(oldest);
        }
        return wait;
    }
}

public record Result(string Name, int Origin, int Hits, int Joined, long Wait, bool Ok);

public static class Program
{
    static Result Simulate(string name, bool shielded, bool coalesce)
    {
        uint seed = 99;
        Func<int> next = () => { seed = unchecked(seed * 1664525u + 1013904223u); return (int)(seed >> 8); };
        var edges = Enumerable.Range(0, Cdn.Pops).Select(_ => new Cache(Cdn.EdgeCap)).ToArray();
        var shield = new Cache(Cdn.ShieldCap);
        int origin = 0; long now = 0, totalWait = 0;
        Func<long> fromOrigin = () => { origin++; return Cdn.OriginTrip + Cdn.OriginWork; };
        for (int i = 0; i < Cdn.Requests; i++)
        {
            now += 1 + next() % 3;
            long u = next() % 10000; int key = (int)(u * u * u / 2000000000L);    // cubing a uniform number favours low keys: a few popular objects
            var edge = edges[next() % Cdn.Pops];
            totalWait += edge.Lookup(key, now, coalesce, () => shielded ? Cdn.EdgeShield + shield.Lookup(key, now, coalesce, fromOrigin) : fromOrigin());
        }
        bool ok = edges.All(e => e.Items.Count <= Cdn.EdgeCap) && edges.Sum(e => e.Hits + e.Joined + e.Misses) == Cdn.Requests;
        return new Result(name, origin, edges.Sum(e => e.Hits), edges.Sum(e => e.Joined), totalWait / Cdn.Requests, ok);
    }

    // 100 requests for a new object arrive within 100 ms while its fetch takes 110 ms.
    static int Herd(bool coalesce)
    {
        var cache = new Cache(10); int fetches = 0;
        for (int t = 0; t < 100; t++) cache.Lookup(7, t, coalesce, () => { fetches++; return 110; });
        return fetches;
    }

    public static int Main()
    {
        var runs = new[] { Simulate("edge only", false, false), Simulate("edge only + coalescing", false, true), Simulate("edge + shield", true, false), Simulate("edge + shield + coalescing", true, true) };
        foreach (var r in runs) Console.WriteLine($"{r.Name}: {r.Origin} origin requests, edge hit ratio {r.Hits * 1000 / Cdn.Requests} per mille, {r.Joined} joined, average wait {r.Wait} ms");
        Result loose = runs[0], joined = runs[1], shielded = runs[2], both = runs[3];
        Console.WriteLine($"herd of 100 requests: {Herd(false)} origin fetches without coalescing, {Herd(true)} with it");
        Console.WriteLine($"origin load: {loose.Origin} -> {both.Origin} ({both.Origin * 100 / loose.Origin}% of the edge-only load)");
        bool good = runs.All(r => r.Ok) && joined.Origin <= loose.Origin && shielded.Origin < loose.Origin && both.Origin <= shielded.Origin && both.Origin < loose.Origin && Herd(false) == 100 && Herd(true) == 1;
        return good ? 0 : 1;
    }
}
