// DRY and the wrong abstraction: retail and wholesale shipping start out looking identical. Part 1 has the three designs as real
// functions (copy-paste, one merged function with flags, a shared core with separate edges) after four change requests that each
// concern ONE case, and shows they agree while their signatures differ. Part 2 counts the edits over a year of 20 change
// requests, as the share that concern only one case grows. Look for: the flag count and 2^flags of the merged function, and where
// copy-paste and merging cross over.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

public static class Program
{
    static int CeilKg(int grams) => (grams + 999) / 1000;
    static int Tariff(int grams) => 500 + 120 * CeilKg(grams); // the carrier's price list: real, shared knowledge (cents)

    // 1. Copy-paste: each case keeps its own copy of the tariff formula.
    static int RetailCopy(int grams, int order, bool remote)
    {
        if (order >= 5000) return 0;                                   // change 1: retail free shipping over 50.00
        return 500 + 120 * CeilKg(grams) + (remote ? 300 : 0);         // change 2: retail remote-area surcharge
    }
    static int WholesaleCopy(int grams)
    {
        int c = 500 + 120 * CeilKg(grams);
        if (grams > 20000) c -= 40 * CeilKg(grams);                    // change 3: wholesale pallet discount
        return c + c * 8 / 100;                                        // change 4: wholesale fuel surcharge of 8%
    }
    // 2. Merged: one function that serves both, so every difference became a flag.
    static int Merged(int grams, int order, bool freeOver, bool remote, bool pallet, bool fuel)
    {
        int c = Tariff(grams);
        if (freeOver && order >= 5000) return 0;
        if (remote) c += 300;
        if (pallet && grams > 20000) c -= 40 * CeilKg(grams);
        if (fuel) c += c * 8 / 100;
        return c;
    }
    // 3. Shared core, separate edges: only the price list is shared.
    static int RetailShared(int grams, int order, bool remote) => order >= 5000 ? 0 : Tariff(grams) + (remote ? 300 : 0);
    static int WholesaleShared(int grams) { int c = Tariff(grams) - (grams > 20000 ? 40 * CeilKg(grams) : 0); return c + c * 8 / 100; }

    static int Params(string name) => typeof(Program).GetMethod(name, BindingFlags.NonPublic | BindingFlags.Static)!.GetParameters().Length;

    // Part 2: a year of N change requests. Some concern both cases (the price list changes), the rest only one of them.
    // copy-paste: a shared change is made twice (and a copy can be missed); a divergent one once.
    // merged: the merge itself is 1 edit; a shared change is 1 edit; a divergent one is 2 (the new flag, and the call that sets it).
    //         every divergent change adds one flag, and the flags can combine: 2^flags paths.
    // shared core: extracting the core is 1 edit; every change is 1 edit, in the core or in one edge.
    const int N = 20;
    static (int edits, int flags, long paths, int risk) Year(int pct, string design)
    {
        int d = N * pct / 100, s = N - d;
        if (design == "copy") return (2 * s + d, 0, 1, s);
        if (design == "merged") return (1 + s + 2 * d, d, 1L << d, d);
        return (1 + N, 0, 1, 0);
    }

    public static void Main()
    {
        var shipments = new (int g, int o, bool r)[] { (2500, 3000, false), (800, 9000, false), (30000, 12000, true), (21500, 400, true) };
        bool agree = true;
        foreach (var (g, o, r) in shipments)
        {
            var a = new[] { RetailCopy(g, o, r), Merged(g, o, true, r, false, false), RetailShared(g, o, r) };
            var b = new[] { WholesaleCopy(g), Merged(g, o, false, false, true, true), WholesaleShared(g) };
            if (a.Distinct().Count() > 1 || b.Distinct().Count() > 1) agree = false;
            Console.WriteLine($"{g} g, order {o}, remote {(r ? "true" : "false")}: retail {a[0]}, wholesale {b[0]}");
        }
        Console.WriteLine($"all three designs agree: {(agree ? "true" : "false")}");
        Console.WriteLine($"parameters: copy-paste {Params("RetailCopy")} and {Params("WholesaleCopy")}, merged {Params("Merged")}, shared core {Params("RetailShared")} and {Params("WholesaleShared")} (plus tariff {Params("Tariff")})");
        foreach (var pct in new[] { 0, 25, 50, 75, 100 })
        {
            var row = new[] { "copy", "merged", "core" }.Select(x => { var r = Year(pct, x); return $"{x} {r.edits} edits, {r.flags} flags, {r.paths} paths, {r.risk} risk"; });
            Console.WriteLine($"{pct}% divergent ({N * pct / 100} of {N}): {string.Join(" | ", row)}");
        }
    }
}
