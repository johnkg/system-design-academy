// Quorum reads and writes in C#: N replicas, a write waits for W of them, a read asks R of them.
// To show the worst case, a write reaches the FIRST W replicas and a read asks the LAST R replicas.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        Demo(3, 2, 2); // quorums overlap
        Demo(3, 1, 1); // fastest, but can read stale data
        Demo(3, 3, 1); // slow, fragile writes, but any single replica is up to date
        Demo(5, 3, 3); // a common majority setting
        Demo(5, 2, 3); // 5 is not greater than 5: stale read possible
    }

    static void Demo(int n, int w, int r)
    {
        var cluster = new Cluster(n);
        var wrote = cluster.Write("v2", w);
        var (asked, value) = cluster.Read(r);
        var guaranteed = r + w > n;
        Console.WriteLine($"N={n} W={w} R={r}: wrote [{string.Join(",", wrote)}], read [{string.Join(",", asked)}] -> {value}  (R+W {(guaranteed ? ">" : "<=")} N: {(guaranteed ? "fresh read guaranteed" : "stale read possible")})");
    }
}

public record Replica(int Version, string Value);

public class Cluster
{
    private readonly Replica[] _replicas;

    public Cluster(int n) => _replicas = Enumerable.Range(0, n).Select(_ => new Replica(1, "v1")).ToArray();

    public List<int> Write(string value, int w)
    {
        var version = _replicas.Max(r => r.Version) + 1;
        var reached = new List<int>();
        for (var i = 0; i < w; i++) { _replicas[i] = new Replica(version, value); reached.Add(i); } // the other replicas are slow and miss it
        return reached;
    }

    public (List<int> Asked, string Value) Read(int r)
    {
        var asked = Enumerable.Range(0, _replicas.Length).TakeLast(r).ToList();
        var newest = asked.Select(i => _replicas[i]).Aggregate((a, b) => b.Version > a.Version ? b : a); // newest version wins
        return (asked, newest.Value);
    }
}
