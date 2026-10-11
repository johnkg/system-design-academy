// Maglev-style consistent hashing for a load balancer, in C#:
// every balancer builds the same lookup table from the backend names, so any of them sends a flow to the same backend,
// and when a backend leaves only the flows that were on it have to move. A connection-tracking table then pins live flows.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Maglev
{
    public const int M = 997; // table size, a prime number (Maglev uses 65,537 or more)

    public static uint HashName(string s, uint seed) // FNV-1a with a seed, kept to 32 bits
    {
        uint h = seed ^ 2166136261u;
        foreach (char ch in s) h = unchecked((h ^ ch) * 16777619u);
        return h;
    }

    public static uint FlowHash(int i) // stands in for a hash of the 5-tuple (source and destination address and port, protocol)
    {
        uint h = unchecked((uint)(i + 1) * 2654435761u);
        h ^= h >> 15; h = unchecked(h * 2246822519u);
        return h ^ (h >> 13);
    }

    // Each backend has its own permutation of the table slots. Backends take turns claiming their next free slot.
    public static string[] BuildTable(string[] names)
    {
        var offset = names.Select(n => (int)(HashName(n, 1) % M)).ToArray();
        var skip = names.Select(n => (int)(HashName(n, 2) % (M - 1)) + 1).ToArray();
        var next = new long[names.Length];
        var table = Enumerable.Repeat(-1, M).ToArray();
        for (int filled = 0; filled < M;)
        {
            for (int b = 0; b < names.Length && filled < M; b++)
            {
                int slot = (int)((offset[b] + next[b] * skip[b]) % M);
                while (table[slot] >= 0) { next[b]++; slot = (int)((offset[b] + next[b] * skip[b]) % M); }
                table[slot] = b; next[b]++; filled++;
            }
        }
        return table.Select(b => names[b]).ToArray();
    }
}

public static class Program
{
    static string Pct(int part, int whole) { int t = part * 1000 / whole; return $"{t / 10}.{t % 10}%"; }

    public static int Main()
    {
        const int M = Maglev.M, Flows = 20000;
        var names = new[] { "b0", "b1", "b2", "b3", "b4" };
        var table = Maglev.BuildTable(names);
        var share = names.ToDictionary(n => n, n => 0);
        for (int i = 0; i < Flows; i++) share[table[Maglev.FlowHash(i) % M]]++;
        Console.WriteLine("flows per backend: " + string.Join(" ", names.Select(n => $"{n}={share[n]}")));

        // Remove b2: how many flows that were NOT on b2 get moved, with a modulo hash and with the Maglev table?
        var smaller = names.Where(n => n != "b2").ToArray();
        var table2 = Maglev.BuildTable(smaller);
        int onB2 = 0, moduloMoved = 0, maglevMoved = 0;
        for (int i = 0; i < Flows; i++)
        {
            uint h = Maglev.FlowHash(i);
            string before = table[h % M];
            if (before == "b2") { onB2++; continue; }
            if (names[h % names.Length] != smaller[h % smaller.Length]) moduloMoved++;
            if (before != table2[h % M]) maglevMoved++;
        }
        int others = Flows - onB2;
        Console.WriteLine($"b2 removed, flows on b2 (must move): {onB2}");
        Console.WriteLine($"other flows moved, modulo hash: {moduloMoved} of {others} ({Pct(moduloMoved, others)})");
        Console.WriteLine($"other flows moved, Maglev table: {maglevMoved} of {others} ({Pct(maglevMoved, others)})");

        // Connection tracking: a new flow is looked up in the table once, then remembered, so adding b5 later never breaks it.
        var tracked = new Dictionary<int, string>();
        string Route(int i, string[] tbl) { if (!tracked.ContainsKey(i)) tracked[i] = tbl[Maglev.FlowHash(i) % M]; return tracked[i]; }
        for (int i = 0; i < Flows; i++) Route(i, table);
        var table3 = Maglev.BuildTable(names.Append("b5").ToArray());
        int brokenTracked = 0, brokenUntracked = 0;
        for (int i = 0; i < Flows; i++)
        {
            if (Route(i, table3) != table[Maglev.FlowHash(i) % M]) brokenTracked++;
            if (table3[Maglev.FlowHash(i) % M] != table[Maglev.FlowHash(i) % M]) brokenUntracked++;
        }
        Console.WriteLine($"b5 added: broken flows without tracking {brokenUntracked} ({Pct(brokenUntracked, Flows)}), with tracking {brokenTracked}");

        var counts = share.Values.ToList();
        bool ok = counts.Max() - counts.Min() < Flows / names.Length / 10 && maglevMoved * 5 < others && moduloMoved * 2 > others && brokenTracked == 0;
        Console.WriteLine($"checks pass: {(ok ? "true" : "false")}");
        return ok ? 0 : 1;
    }
}
