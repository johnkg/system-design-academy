// Consistent hashing in C#: a hash ring with virtual nodes.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        var keys = Enumerable.Range(0, 10000).Select(i => $"key-{i}").ToList();
        var ring = new HashRing(100);
        foreach (var n in new[] { "A", "B", "C" }) ring.AddNode(n);

        var before = keys.ToDictionary(k => k, ring.NodeFor);
        var load = before.Values.GroupBy(v => v).OrderBy(g => g.Key).ToDictionary(g => g.Key, g => g.Count());
        Console.WriteLine("keys per node: {" + string.Join(",", load.Select(kv => $"\"{kv.Key}\":{kv.Value}")) + "}");

        ring.AddNode("D");
        int movedRing = keys.Count(k => before[k] != ring.NodeFor(k));
        int movedMod = keys.Count(k => Hashing.Hash32(k) % 3 != Hashing.Hash32(k) % 4);
        Console.WriteLine($"adding a 4th node moves {movedRing / 100.0:F1}% of keys on the ring, {movedMod / 100.0:F1}% with hash mod N");
    }
}

public static class Hashing
{
    public static uint Hash32(string text) // FNV-1a followed by a bit mixer, so similar strings land far apart
    {
        uint h = 2166136261;
        foreach (char c in text) { h ^= c; h *= 16777619; }
        h ^= h >> 16; h *= 0x85ebca6b;
        h ^= h >> 13; h *= 0xc2b2ae35;
        h ^= h >> 16;
        return h;
    }
}

public class HashRing(int virtualNodes = 100)
{
    private readonly List<(uint Pos, string Node)> _points = new(); // sorted by position around the ring

    public void AddNode(string name)
    {
        for (int i = 0; i < virtualNodes; i++) _points.Add((Hashing.Hash32($"{name}#{i}"), name));
        _points.Sort((a, b) => a.Pos.CompareTo(b.Pos));
    }

    public void RemoveNode(string name) => _points.RemoveAll(p => p.Node == name);

    public string NodeFor(string key) // first point at or after the key's position, wrapping past the end
    {
        uint h = Hashing.Hash32(key);
        int lo = 0, hi = _points.Count;
        while (lo < hi) { int mid = (lo + hi) / 2; if (_points[mid].Pos < h) lo = mid + 1; else hi = mid; }
        return _points[lo % _points.Count].Node;
    }
}
