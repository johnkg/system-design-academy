// A replicated key-value store with tunable quorums in C#:
// keys are placed on a hash ring, each key lives on N nodes, a write waits for W of them and a read asks R of them.
using System;
using System.Collections.Generic;
using System.Linq;

public record Entry(string Value, int Version);

public class Node
{
    public bool Up = true;
    public Dictionary<string, Entry> Data = new();
}

public class Ring
{
    public const int N = 3; // copies of every key
    public const int TokensPerNode = 16; // virtual nodes on the ring per server
    readonly List<(uint At, string Name)> tokens;

    public static uint Hash(string text) // FNV-1a: a small, fast, well-spread hash
    {
        uint h = 2166136261;
        foreach (char ch in text) { h ^= ch; h *= 16777619; }
        return h;
    }

    public Ring(IEnumerable<string> names, int tokensPerNode = TokensPerNode)
    {
        tokens = names.SelectMany(name => Enumerable.Range(0, tokensPerNode).Select(i => (Hash($"{name}#{i}"), name))).OrderBy(t => t.Item1).ToList();
    }

    // Walk clockwise from the key's position and collect the first N different nodes.
    public List<string> PreferenceList(string key)
    {
        uint h = Hash(key);
        int i = tokens.FindIndex(t => t.At >= h);
        if (i < 0) i = 0;
        var result = new List<string>();
        for (int step = 0; step < tokens.Count && result.Count < N; step++)
        {
            string name = tokens[(i + step) % tokens.Count].Name;
            if (!result.Contains(name)) result.Add(name);
        }
        return result;
    }
}

public class Cluster
{
    readonly Ring ring;
    public readonly Dictionary<string, Node> Nodes;
    int clock; // a version number that only grows (real systems use vector clocks or timestamps)

    public Cluster(string[] names)
    {
        ring = new Ring(names);
        Nodes = names.ToDictionary(n => n, n => new Node());
    }

    public List<string> PreferenceList(string key) => ring.PreferenceList(key);

    public void Put(string key, string value, int w)
    {
        int version = ++clock;
        int acks = 0;
        foreach (var name in ring.PreferenceList(key))
        {
            var node = Nodes[name];
            if (!node.Up) continue; // a node that is down simply misses this write
            node.Data[key] = new Entry(value, version);
            acks++;
        }
        if (acks < w) throw new InvalidOperationException($"only {acks} of the {w} required replicas answered");
    }

    // Ask the given replicas and return the newest answer, without changing anything.
    public (List<(string Name, Entry? Entry)> Answers, Entry? Newest) Read(string key, IEnumerable<string> ask)
    {
        var answers = ask.Select(n => (n, Nodes[n].Data.GetValueOrDefault(key))).ToList();
        Entry? newest = null;
        foreach (var (_, entry) in answers) if (entry != null && (newest == null || entry.Version > newest.Version)) newest = entry;
        return (answers, newest);
    }

    // Ask R replicas (the first R that are up) and return the newest answer, then fix any replica that answered with old data.
    public string? Get(string key, int r)
    {
        var ask = ring.PreferenceList(key).Where(n => Nodes[n].Up).Take(r).ToList();
        if (ask.Count < r) throw new InvalidOperationException("not enough replicas are up");
        var (answers, newest) = Read(key, ask);
        if (newest != null)
            foreach (var (name, entry) in answers) if ((entry?.Version ?? 0) < newest.Version) Nodes[name].Data[key] = newest; // read repair
        return newest?.Value;
    }
}

public static class Program
{
    static IEnumerable<List<string>> Choose(List<string> list, int r)
    {
        if (r == 0) { yield return new List<string>(); yield break; }
        for (int i = 0; i < list.Count; i++)
            foreach (var rest in Choose(list.Skip(i + 1).ToList(), r - 1))
                yield return new List<string> { list[i] }.Concat(rest).ToList();
    }

    public static int Main()
    {
        const int N = Ring.N;
        int wrong = 0;
        foreach (var (w, r) in new[] { (2, 2), (3, 1), (1, 1) })
        {
            var cluster = new Cluster(new[] { "A", "B", "C", "D", "E" });
            string key = "user:42";
            var replicas = cluster.PreferenceList(key);
            cluster.Put(key, "old", N); // everything is in sync
            cluster.Nodes[replicas[2]].Up = false; // one replica goes down...
            bool strong = w + r > N;
            string label = $"N={N} W={w} R={r} ({(strong ? "W+R>N" : "W+R<=N")})  replicas {string.Join(",", replicas)}";
            try { cluster.Put(key, "new", w); } // ...and misses this write; asking for W=3 then fails
            catch (InvalidOperationException e)
            {
                Console.WriteLine($"{label}  write rejected while one replica is down: {e.Message}");
                if (w < N) wrong++;
                continue;
            }
            cluster.Nodes[replicas[2]].Up = true; // it comes back, still holding the old value
            var choices = Choose(replicas, r).ToList(); // try every choice of replicas to ask
            int stale = choices.Count(ask => cluster.Read(key, ask).Newest?.Value != "new");
            Console.WriteLine($"{label}  stale reads: {stale} of {choices.Count} possible choices");
            if (strong && stale > 0) wrong++;     // overlapping quorums must never return old data
            if (!strong && stale == 0) wrong++;   // and without overlap, stale data must be possible
        }
        return wrong > 0 ? 1 : 0;
    }
}
