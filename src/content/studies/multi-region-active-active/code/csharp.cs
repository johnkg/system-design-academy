// Three active-active regions in C#:
// a last-writer-wins register loses concurrent increments and obeys a skewed clock, while a counter CRDT merges to the exact total.
using System;
using System.Linq;

public record Lww<T>(T Value, int Ts, int Region);

public static class Rules
{
    public static readonly int[] Skew = { 0, 2, -3 }; // each region's wall clock is a little off
    public static readonly int Regions = Skew.Length;
    public const int Steps = 600;
    public const int ReplicateOneIn = 4; // a replication round on one step in 4
    static uint seed = 7;
    public static int Rand(int n) { seed = unchecked(seed * 1664525 + 1013904223); return (int)((seed >> 16) % (uint)n); }

    // Last-writer-wins: the higher timestamp wins, and the higher region id breaks a tie.
    public static bool Wins<T>(Lww<T> a, Lww<T> b) => a.Ts > b.Ts || (a.Ts == b.Ts && a.Region > b.Region);
    public static Lww<T> Merge<T>(Lww<T> mine, Lww<T> theirs) => Wins(theirs, mine) ? theirs : mine;
}

public class Region
{
    public readonly int Id;
    public Lww<int> Likes;        // likes kept as one LWW register
    public int[] Counts = { 0, 0, 0 }; // likes kept as a G-counter: one slot per region
    public Lww<string> Name;

    public Region(int id) { Id = id; Likes = new(0, 0, id); Name = new("none", 0, id); }
    int Clock(int step) => step + Rules.Skew[Id];
    public void Like(int step)
    {
        Likes = new(Likes.Value + 1, Clock(step), Id); // read, add one, write back
        Counts[Id]++;
    }
    public void Rename(int step, string value) => Name = new(value, Clock(step), Id);
    public void MergeFrom(Region other) // replication: apply the other region's state
    {
        Likes = Rules.Merge(Likes, other.Likes);
        Name = Rules.Merge(Name, other.Name);
        Counts = Counts.Select((c, i) => Math.Max(c, other.Counts[i])).ToArray();
    }
    public int Total() => Counts.Sum();
}

public static class Program
{
    public static int Main()
    {
        var regions = Enumerable.Range(0, Rules.Regions).Select(i => new Region(i)).ToArray();
        int truth = 0;
        for (int step = 1; step <= Rules.Steps; step++)
        {
            int r = Rules.Rand(Rules.Regions);
            regions[r].Like(step);
            truth++;
            if (step == 100) regions[0].Rename(step, "alice-old");
            if (step == 101) regions[2].Rename(step, "alice-new"); // really later, but region 2's clock runs 3 behind
            if (Rules.Rand(Rules.ReplicateOneIn) == 0) // lazy replication between random pairs
            {
                int src = Rules.Rand(Rules.Regions), dst = (src + 1 + Rules.Rand(Rules.Regions - 1)) % Rules.Regions;
                regions[dst].MergeFrom(regions[src]);
            }
        }

        Console.WriteLine($"likes really given: {truth}");
        Console.WriteLine($"before sync, LWW likes per region: {string.Join(", ", regions.Select(r => r.Likes.Value))}");
        Console.WriteLine($"before sync, CRDT likes per region: {string.Join(", ", regions.Select(r => r.Total()))}");

        for (int round = 0; round < 2; round++) // anti-entropy: every pair exchanges state
            foreach (var a in regions) foreach (var b in regions) if (a != b) a.MergeFrom(b);

        var lww = regions.Select(r => r.Likes.Value).ToArray();
        var crdt = regions.Select(r => r.Total()).ToArray();
        Console.WriteLine($"after sync, LWW likes: {string.Join(", ", lww)} (lost {truth - lww[0]})");
        Console.WriteLine($"after sync, CRDT likes: {string.Join(", ", crdt)} (lost {truth - crdt[0]})");
        Console.WriteLine($"name everywhere: {string.Join(", ", regions.Select(r => r.Name.Value))}");

        bool converged = lww.Distinct().Count() == 1 && crdt.Distinct().Count() == 1 && regions.Select(r => r.Name.Value).Distinct().Count() == 1;
        Console.WriteLine($"converged: {(converged ? "true" : "false")}");
        return !converged || crdt[0] != truth || lww[0] >= truth || regions[0].Name.Value != "alice-old" ? 1 : 0;
    }
}
