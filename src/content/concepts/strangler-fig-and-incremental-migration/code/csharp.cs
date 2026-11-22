// Strangler fig: a legacy shop with 8 slices is replaced by a new system four ways, for a few shadow-traffic and ramp-up settings.
// Look for: days until real users reach the new system, the most traffic switched in one step, requests hit by bugs before they were noticed,
// bugs still silent after the migration, and how many data links cross the old/new boundary at the worst moment.
// Model: each slice has traffic (thousand requests a day) and hidden bugs (each fires on `rate` of every 1,000 requests of its slice).
// Shadow mode replays real requests to both systems and compares the answers: a bug counts as caught before any user sees it when its expected number of firings in the replay is at least 1 (a deterministic simplification: real catches are probabilistic).
// A ramp moves a share of a slice's traffic for one day per step. A monitor alerts when a bug hits 20 or more requests a day. Without rollback, fixing forward takes 5 days.
// Assumptions: building a slice takes 21 days (7 days for a slice a third the size), the team builds slices one after another, and ramp days overlap with the next build.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const int Alert = 20, FixForwardDays = 5;

    record Slice(int Parent, int Part, int Traffic, int[] Bugs);
    record Design(string Name, int Split, bool Shadow, bool Ramp, bool Rollback);

    static readonly (string Name, int Traffic, int[] Bugs)[] Slices =
    {
        ("accounts", 30, new[] { 40 }), ("catalog", 120, new[] { 2 }), ("search", 90, new int[] { }), ("cart", 60, new[] { 15, 1 }),
        ("checkout", 30, new[] { 50, 3 }), ("orders", 24, new[] { 8 }), ("invoices", 9, new[] { 30, 1 }), ("reports", 6, new int[] { }),
    };
    static readonly (int, int)[] Links = { (0, 3), (0, 4), (1, 2), (1, 3), (3, 4), (4, 5), (5, 6), (5, 7), (6, 7) }; // slices that share data
    static readonly (string Name, int[] Steps)[] Ramps =
    {
        ("All at once", new[] { 100 }), ("1% then everything", new[] { 1, 100 }), ("1, 10, 50, 100", new[] { 1, 10, 50, 100 }),
        ("10% steps", new[] { 10, 20, 30, 40, 50, 60, 70, 80, 90, 100 }),
    };
    static readonly Design[] Designs =
    {
        new("Big-bang rewrite", 1, true, false, false),
        new("Strangler with parity checks", 1, true, true, true),
        new("Strangler without parity checks", 1, false, true, true),
        new("Slices of one endpoint", 3, true, true, true),
    };

    static List<Slice> SlicesOf(int split) // split each slice in `split` parts: traffic is shared out, bug i goes to part i % split
    {
        var o = new List<Slice>();
        for (int p = 0; p < Slices.Length; p++)
            for (int j = 0; j < split; j++)
                o.Add(new Slice(p, j, Slices[p].Traffic / split, Slices[p].Bugs.Where((_, i) => i % split == j).ToArray()));
        return o;
    }

    static List<(int, int)> LinksOf(int split, List<Slice> slices)
    {
        if (split == 1) return Links.ToList();
        int Idx(int p, int j) => slices.FindIndex(s => s.Parent == p && s.Part == j);
        var o = new List<(int, int)>();
        foreach (var (a, b) in Links) for (int j = 0; j < split; j++) o.Add((Idx(a, j), Idx(b, j)));
        for (int p = 0; p < Slices.Length; p++) for (int j = 0; j + 1 < split; j++) o.Add((Idx(p, j), Idx(p, j + 1)));
        return o;
    }

    static int PeakCrossing(List<Slice> slices, List<(int, int)> links) // slices move in order; count links with one end moved and the other not
    {
        int peak = 0;
        for (int k = 1; k < slices.Count; k++) peak = Math.Max(peak, links.Count(l => (l.Item1 < k) != (l.Item2 < k)));
        return peak;
    }

    static int[] Run(Design d, int shadowRequests, int[] ramp)
    {
        var slices = SlicesOf(d.Split);
        int total = Slices.Sum(x => x.Traffic);
        var steps = d.Ramp ? ramp : new[] { 100 };
        int shadow = d.Shadow ? shadowRequests : 0;
        int harm = 0, silent = 0, caught = 0, bugs = 0, widest = 0;
        foreach (var s in slices)
        {
            int prev = 0;
            foreach (var share in steps) { widest = Math.Max(widest, (share - prev) * s.Traffic / total); prev = share; }
            foreach (var rate in s.Bugs)
            {
                bugs++;
                if (shadow * rate / 1000 >= 1) { caught++; continue; }
                bool noticed = false;
                foreach (var share in steps)
                {
                    int hit = s.Traffic * share * rate / 100; // requests a day that fire the bug at this share
                    if (hit >= Alert) { harm += d.Rollback ? hit : hit * FixForwardDays; noticed = true; break; }
                    harm += hit;
                }
                if (!noticed) silent++;
            }
        }
        int buildDays = d.Split == 1 ? 21 : 7;
        int first = d.Ramp ? buildDays : 21 * Slices.Length;
        int finish = d.Ramp ? buildDays * slices.Count + steps.Length : 21 * Slices.Length + 1;
        return new[] { first + 1, finish, d.Ramp ? widest : 100, caught, bugs, harm, silent, d.Ramp ? PeakCrossing(slices, LinksOf(d.Split, slices)) : 0, d.Ramp ? slices.Count : 1 };
    }

    public static void Main()
    {
        foreach (var (shadow, rampIdx) in new[] { (0, 2), (500, 2), (2000, 2), (500, 0) })
        {
            Console.WriteLine($"-- shadow {shadow} requests per slice, ramp \"{Ramps[rampIdx].Name}\"");
            foreach (var d in Designs)
            {
                var r = Run(d, shadow, Ramps[rampIdx].Steps);
                Console.WriteLine($"  {d.Name}: first users on day {r[0]}, done on day {r[1]}, widest step {r[2]}% of all traffic, shadow caught {r[3]} of {r[4]} bugs, requests hit before noticed {r[5]}, bugs silent {r[6]}, data links across the boundary at worst {r[7]}, slices to route {r[8]}");
            }
        }
    }
}
