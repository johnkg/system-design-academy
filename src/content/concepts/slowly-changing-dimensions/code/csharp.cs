// Slowly changing dimensions: Type 1 overwrite vs Type 2 history, in C#.
// Customers move between regions while sales continue. Days are 1..360; a row is valid for from <= day < to.
using System;
using System.Collections.Generic;
using System.Linq;

public record Change(int Cust, int Eff, int Arrive, string Region, string Tier);
public record Fact(int Id, int Day, int Cust, int Amount);
public class Row { public int Sk, Cust, From; public int? To; public string Region = ""; public uint Hash; }
public class Loaded
{
    public List<Row> Rows = new(); public int Skipped, Rekeyed;
    public Dictionary<int, int> FactSk = new();
    public string RegionOf(Fact f) => Rows.First(r => r.Sk == FactSk[f.Id]).Region;
}

public static class Program
{
    static readonly string[] Regions = { "North", "South", "East", "West" };
    static readonly string[] Init = { "North", "South", "East", "South", "West", "East", "North", "West" };
    // The change feed: effective day, arrival day, customer index, new region and tier.
    static readonly Change[] Feed =
    {
        new(6, 80, 80, "South", "basic"),
        new(1, 100, 100, "West", "basic"),
        new(3, 150, 250, "East", "basic"),  // late-arriving: effective day 150, delivered on day 250
        new(4, 200, 200, "North", "basic"),
        new(0, 200, 200, "North", "basic"), // redelivered, nothing changed
        new(4, 220, 220, "North", "gold"),  // tier only: still a new version, because tier is tracked
        new(6, 270, 270, "East", "basic"),
        new(2, 300, 300, "South", "basic"),
    };
    static List<Fact> facts = new();

    static uint HashOf(string region, string tier) // hash of the tracked attributes only (FNV-1a, 32 bit)
    {
        uint h = 2166136261;
        foreach (var ch in $"{region}|{tier}") h = unchecked((h ^ ch) * 16777619);
        return h;
    }

    static Loaded Load(int type, bool correctLate)
    {
        var l = new Loaded();
        for (int c = 0; c < 8; c++) l.Rows.Add(new Row { Sk = c + 1, Cust = c, Region = Init[c], Hash = HashOf(Init[c], "basic"), From = 1, To = null });
        Row Covering(int cust, int day) => l.Rows.First(r => r.Cust == cust && r.From <= day && (r.To == null || day < r.To));
        var events = Feed.Select((c, i) => (key: (long)c.Arrive * 1000000 + i, change: (Change?)c, fact: (Fact?)null))
            .Concat(facts.Select(f => (key: (long)f.Day * 1000000 + 100000 + f.Id, change: (Change?)null, fact: (Fact?)f)))
            .OrderBy(e => e.key);
        foreach (var e in events)
        {
            if (e.change is Change c)
            {
                var h = HashOf(c.Region, c.Tier);
                if (type == 1) // overwrite in place: no history
                {
                    var r = l.Rows.First(x => x.Cust == c.Cust);
                    if (r.Hash == h) l.Skipped++; else { r.Region = c.Region; r.Hash = h; }
                }
                else // Type 2: close the version that was open, insert the new one
                {
                    int vf = correctLate ? c.Eff : c.Arrive; // valid_from = when it became true, not when we heard
                    var old = Covering(c.Cust, vf);
                    if (old.Hash == h) { l.Skipped++; continue; }
                    var row = new Row { Sk = l.Rows.Count + 1, Cust = c.Cust, Region = c.Region, Hash = h, From = vf, To = old.To };
                    old.To = vf; l.Rows.Add(row);
                    foreach (var f in facts) // facts already loaded for that period point at the old version: re-key them
                        if (f.Cust == c.Cust && l.FactSk.ContainsKey(f.Id) && f.Day >= row.From && (row.To == null || f.Day < row.To)) { l.FactSk[f.Id] = row.Sk; l.Rekeyed++; }
                }
            }
            else // point-in-time lookup: the version valid on the sale date
            {
                var f = e.fact!;
                l.FactSk[f.Id] = type == 1 ? l.Rows.First(x => x.Cust == f.Cust).Sk : Covering(f.Cust, f.Day).Sk;
            }
        }
        return l;
    }

    static string TruthRegion(Fact f) // reality, from the feed alone (effective dates)
    {
        var region = Init[f.Cust]; int best = 0;
        foreach (var c in Feed) if (c.Cust == f.Cust && c.Eff <= f.Day && c.Eff >= best) { region = c.Region; best = c.Eff; }
        return region;
    }
    static Dictionary<string, int> Revenue(Func<Fact, string> regionOf)
    {
        var t = Regions.ToDictionary(r => r, r => 0);
        foreach (var f in facts) t[regionOf(f)] += f.Amount;
        return t;
    }
    static void Show(string name, Dictionary<string, int> t) =>
        Console.WriteLine(name.PadRight(13) + string.Join("  ", Regions.Select(r => $"{r} {t[r],5}")));
    static bool Same(Dictionary<string, int> a, Dictionary<string, int> b) => Regions.All(r => a[r] == b[r]);
    static void Check(bool ok, string msg) { if (!ok) { Console.WriteLine("FAILED: " + msg); Environment.Exit(1); } }

    public static void Main()
    {
        uint seed = 7; // 32-bit LCG so every language produces the same sales
        int Next() { seed = unchecked(seed * 1664525 + 1013904223); return (int)(seed >> 8); }
        for (int id = 0; id < 200; id++) { int day = 1 + Next() % 360, cust = Next() % 8, amount = 20 + Next() % 181; facts.Add(new Fact(id, day, cust, amount)); }

        var truth = Revenue(TruthRegion);
        var t1 = Load(1, false); var t2naive = Load(2, false); var t2fix = Load(2, true);
        Show("true then", truth);
        Show("type 1", Revenue(t1.RegionOf));
        Show("type 2 naive", Revenue(t2naive.RegionOf));
        Show("type 2 fixed", Revenue(t2fix.RegionOf));
        int Wrong(Loaded l) => facts.Count(f => l.RegionOf(f) != TruthRegion(f));
        Console.WriteLine($"rows: type1={t1.Rows.Count} type2naive={t2naive.Rows.Count} type2fixed={t2fix.Rows.Count}");
        Console.WriteLine($"facts on the wrong version: type1={Wrong(t1)} type2naive={Wrong(t2naive)} type2fixed={Wrong(t2fix)}");
        Console.WriteLine($"skipped unchanged records: {t2fix.Skipped}, facts re-keyed by the correction: {t2fix.Rekeyed}");

        Check(Same(Revenue(t2fix.RegionOf), truth), "type 2 with correction must match the true-at-the-time totals");
        Check(!Same(Revenue(t1.RegionOf), truth), "type 1 must differ from the true-at-the-time totals");
        Check(Wrong(t2naive) > 0, "a late change without correction must mis-join some facts");
        foreach (var l in new[] { t1, t2naive, t2fix })
            for (int c = 0; c < 8; c++)
            {
                var mine = l.Rows.Where(r => r.Cust == c).OrderBy(r => r.From).ToList();
                Check(mine.Count(r => r.To == null) == 1, "exactly one current row per customer");
                Check(mine.Select((r, i) => i == 0 || mine[i - 1].To == r.From).All(b => b), "versions must be contiguous");
            }
        Console.WriteLine("all checks passed");
    }
}
