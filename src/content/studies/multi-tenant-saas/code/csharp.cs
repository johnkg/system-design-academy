// A multi-tenant store in C#: a tenant directory routes each tenant to a shard, one big tenant gets its own shard,
// a query that forgets the tenant filter leaks rows unless row-level security is on, and a fair queue protects small tenants.
using System;
using System.Collections.Generic;
using System.Linq;

public record Row(int Id, string Tenant, int Amount);

public static class App
{
    const int Pooled = 3, Dedicated = 3; // shards 0..2 are shared; shard 3 belongs to the big tenant
    static readonly string[] Names = { "acme", "globex", "initech", "umbrella", "hooli", "stark", "wayne", "wonka" };
    static readonly Dictionary<string, int> Dir = new(); // the tenant directory: tenant -> shard
    static List<Row>[] shards = { new(), new(), new(), new() };
    const int BigTenantRows = 40, SmallMinRows = 4, SmallRowSpread = 5; // small tenants have 4..8 rows
    const int MinAmount = 10, AmountSpread = 990;
    const ulong Seed = 7;
    static ulong seed = Seed;

    static uint Hash(string s) { uint h = 2166136261; foreach (char c in s) h = unchecked((h ^ c) * 16777619u); return h; }
    // Linear congruential generator (Numerical Recipes constants), high 16 bits.
    static int Rnd(int n) { seed = (seed * 1664525UL + 1013904223UL) % 4294967296UL; return (int)((seed / 65536) % (ulong)n); }

    // The right query always filters by tenant. The buggy one forgets, and returns the whole shard.
    static List<Row> ListSafe(string t) => shards[Dir[t]].Where(r => r.Tenant == t).ToList();
    static List<Row> ListBuggy(string t) => shards[Dir[t]].ToList();
    // Row-level security: the database applies the policy to every query, whatever the query says.
    static List<Row> WithRls(string session, Func<string, List<Row>> query) => query(session).Where(r => r.Tenant == session).ToList();
    static int Leaked(List<Row> rows, string t) => rows.Count(r => r.Tenant != t);

    // One worker does one job per tick. FIFO serves jobs in arrival order; the fair queue takes one job per tenant in turn.
    static Dictionary<string, int> Finish(string[] order, int[] counts, bool fair)
    {
        var done = new Dictionary<string, int>(); int tick = 0;
        if (!fair)
        {
            for (int i = 0; i < order.Length; i++) { tick += counts[i]; done[order[i]] = tick; }
            return done;
        }
        var left = (int[])counts.Clone();
        while (left.Any(n => n > 0))
            for (int i = 0; i < order.Length; i++)
                if (left[i] > 0) { tick++; left[i]--; if (left[i] == 0) done[order[i]] = tick; }
        return done;
    }

    // Moving a tenant: copy its rows, switch the directory entry, delete the old copy.
    static int MoveTenant(string t, int to)
    {
        int from = Dir[t];
        var rows = shards[from].Where(r => r.Tenant == t).ToList();
        shards[to].AddRange(rows);
        shards[from] = shards[from].Where(r => r.Tenant != t).ToList();
        Dir[t] = to;
        return rows.Count;
    }

    static string Lower(bool b) => b ? "true" : "false";

    public static int Main()
    {
        foreach (var t in Names) Dir[t] = t == "acme" ? Dedicated : (int)(Hash(t) % Pooled);
        int nextId = 1;
        foreach (var t in Names)
        {
            int count = t == "acme" ? BigTenantRows : SmallMinRows + Rnd(SmallRowSpread);
            for (int i = 0; i < count; i++) { shards[Dir[t]].Add(new Row(nextId++, t, MinAmount + Rnd(AmountSpread))); }
        }
        Console.WriteLine("directory: " + string.Join(" ", Names.Select(t => $"{t}->{Dir[t]}")));
        Console.WriteLine("rows per shard: " + string.Join(" ", shards.Select(s => s.Count)));
        bool safeOk = Names.All(t => Leaked(ListSafe(t), t) == 0);
        Console.WriteLine($"filtered query leaks nothing: {Lower(safeOk)}");
        int bugLeak = Names.Sum(t => Leaked(ListBuggy(t), t));
        int rlsLeak = Names.Sum(t => Leaked(WithRls(t, ListBuggy), t));
        Console.WriteLine($"missing filter leaks {bugLeak} rows; with row-level security it leaks {rlsLeak}");

        var order = new[] { "acme", "globex", "initech" }; var counts = new[] { 30, 3, 3 };
        var fifo = Finish(order, counts, false); var fair = Finish(order, counts, true);
        Console.WriteLine($"last job done: fifo globex {fifo["globex"]} initech {fifo["initech"]}; fair globex {fair["globex"]} initech {fair["initech"]}");

        int before = ListSafe("globex").Count;
        int src = Dir["globex"], dst = (src + 1) % Pooled;
        int moved = MoveTenant("globex", dst);
        Console.WriteLine($"moved globex from shard {src} to shard {dst}: {moved} rows, now {ListSafe("globex").Count}");
        bool ok = safeOk && bugLeak > 0 && rlsLeak == 0 && fair["globex"] < fifo["globex"] && moved == before && ListSafe("globex").Count == before;
        return ok ? 0 : 1;
    }
}
