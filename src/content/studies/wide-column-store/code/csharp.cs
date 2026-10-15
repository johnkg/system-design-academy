// A tiny Cassandra-style cluster in C#: a consistent-hash ring with virtual nodes,
// replication factor 3, quorum reads and writes, hinted handoff, read repair and tombstones.
using System;
using System.Collections.Generic;
using System.Linq;
static string Low(bool b) => b ? "true" : "false";
static void Check(bool ok) { if (!ok) Environment.Exit(1); }
static int Gap(List<int> a) => a.Max() - a.Min();
static List<int> Spread(Ring ring) // how many of 1000 keys each node is the first replica for
    => Enumerable.Range(0, 1000).GroupBy(i => ring.Replicas("k" + i)[0]).Select(g => g.Count()).ToList();

var s1 = Spread(new Ring(1)); var s64 = Spread(new Ring(64));
Console.WriteLine($"1 vnode: busiest {s1.Max()}, quietest {s1.Min()}; 64 vnodes: busiest {s64.Max()}, quietest {s64.Min()}");
Check(Gap(s64) < Gap(s1));
for (int w = 1; w <= Ring.RF; w++)
    for (int r = 1; r <= Ring.RF; r++) // worst case: the read set and write set overlap as little as possible
    {
        var f = new Cluster(); var rs = f.Ring.Replicas("x");
        for (int i = 0; i < rs.Count; i++) f.Apply(rs[i], "x", i < w ? new Cell(2, "new") : new Cell(1, "old"));
        bool sees = rs.Skip(Ring.RF - r).Any(n => f.Data[n]["x"].Value == "new");
        Console.WriteLine($"W={w} R={r} reads the new value: {Low(sees)}");
        Check(sees == (r + w > Ring.RF));
    }

var c = new Cluster(); var key = "user:42"; var down = c.Ring.Replicas(key)[2];
Console.WriteLine($"{key} lives on {string.Join(", ", c.Ring.Replicas(key))}");
c.Write(key, "v1", 1, 2); c.Up.Remove(down);
var ok = c.Write(key, "v2", 2, 2);
Console.WriteLine($"{down} down: write ok={Low(ok)}, hints={c.Hints.Count}, read={c.Read(key, 2).Value}");
c.Up.Add(down);
Console.WriteLine($"{down} back: replayed {c.Replay(down)} hint, it holds {c.Data[down][key].Value}");

c.Up.Remove(down); c.Write(key, "v3", 3, 2); c.Hints.Clear(); c.Up.Add(down); // the hint expires before the node returns
var rr = c.Read(key, 2);
Console.WriteLine($"hint lost: read={rr.Value}, repairs={rr.Repairs}, {down} now holds {c.Data[down][key].Value}");
Check(rr.Value == "v3" && rr.Repairs == 1);

string DeleteWhileDown(string k, bool purge) // the third replica misses the delete
{
    var third = c.Ring.Replicas(k)[2];
    c.Write(k, "v3", 3, 3); c.Up.Remove(third);
    c.Write(k, null, 4, 2); c.Hints.Clear();
    if (purge) c.Purge(5);
    c.Up.Add(third);
    var res = c.Read(k, 3);
    return $"{k} purge={Low(purge)}: read={res.Value ?? "deleted"}, repairs={res.Repairs}";
}
var kept = DeleteWhileDown("user:7", false); var zombie = DeleteWhileDown("user:8", true);
Console.WriteLine(kept + "\n" + zombie);
Check(kept.Contains("deleted") && zombie.Contains("read=v3"));
record Cell(int Ts, string? Value);
class Ring
{
    public const int RF = 3;
    public static readonly string[] Names = { "n0", "n1", "n2", "n3", "n4" };
    readonly List<(uint T, string N)> tokens;
    public Ring(int vnodes) => tokens = Names.SelectMany(n => Enumerable.Range(0, vnodes).Select(v => (Fnv1a(n + "#" + v), n))).OrderBy(x => x.Item1).ToList();
    public static uint Fnv1a(string s) // 32-bit FNV-1a, integer maths only
    {
        uint h = 2166136261;
        foreach (char ch in s) { h ^= ch; h *= 16777619; }
        h ^= h >> 15; h *= 2246822519; // finalizer: FNV-1a alone spreads similar keys poorly
        return h ^ (h >> 13);
    }
    public List<string> Replicas(string key) // walk clockwise from the key's position and collect RF distinct nodes
    {
        uint h = Fnv1a(key);
        int i = Math.Max(0, tokens.FindIndex(x => x.T >= h));
        return tokens.Skip(i).Concat(tokens.Take(i)).Select(x => x.N).Distinct().Take(RF).ToList();
    }
}
class Cluster
{
    public Ring Ring = new(16);
    public HashSet<string> Up = new(Ring.Names);
    public List<(string To, string Key, Cell Cell)> Hints = new();
    public Dictionary<string, Dictionary<string, Cell>> Data = Ring.Names.ToDictionary(n => n, n => new Dictionary<string, Cell>());

    public void Apply(string node, string key, Cell cell) // last write wins
        => Data[node][key] = !Data[node].TryGetValue(key, out var cur) || cell.Ts > cur.Ts ? cell : cur;
    public bool Write(string key, string? value, int ts, int w) // a delete is a write of null, a tombstone
    {
        int acks = 0;
        foreach (var n in Ring.Replicas(key))
            if (Up.Contains(n)) { Apply(n, key, new Cell(ts, value)); acks++; }
            else Hints.Add((n, key, new Cell(ts, value))); // hinted handoff
        return acks >= w;
    }
    public int Replay(string node)
    {
        var mine = Hints.Where(h => h.To == node).ToList();
        mine.ForEach(h => Apply(node, h.Key, h.Cell));
        return Hints.RemoveAll(h => h.To == node);
    }
    public (string? Value, int Repairs) Read(string key, int r)
    {
        var live = Ring.Replicas(key).Where(Up.Contains).ToList();
        if (live.Count < r) throw new Exception("not enough replicas for this read");
        var cells = live.Select(n => Data[n].GetValueOrDefault(key)).ToList();
        var newest = cells.Where(c => c != null).MaxBy(c => c!.Ts)!;
        var stale = live.Where((n, i) => cells[i] == null || cells[i]!.Ts < newest.Ts).ToList();
        stale.ForEach(n => Apply(n, key, newest)); // read repair
        return (newest.Value, stale.Count);
    }
    public void Purge(int before) // compaction drops tombstones older than the grace period
    {
        foreach (var m in Data.Values)
            foreach (var k in m.Where(kv => kv.Value.Value == null && kv.Value.Ts < before).Select(kv => kv.Key).ToList()) m.Remove(k);
    }
}
