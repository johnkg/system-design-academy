// A lineage catalog in C#: idempotent ingestion of run events, a graph walked downstream for impact analysis,
// owners to notify, and a search that ranks by how much depends on an asset.
using System;
using System.Collections.Generic;
using System.Linq;

// Outputs are t20..t199.
const int Seed = 7, Events = 300, FirstOutput = 20, OutputRange = 180;
const int AllHops = 99; // a depth limit deeper than any path in this graph
const int Teams = 5;
ulong seed = Seed;
// Linear congruential generator (Numerical Recipes constants), high 16 bits.
int Random(int n) { seed = (seed * 1664525UL + 1013904223UL) % 4294967296UL; return (int)((seed / 65536UL) % (ulong)n); }

var catalog = new Catalog();
int accepted = 0;
for (int k = 0; k < Events; k++)
{
    int outId = FirstOutput + Random(OutputRange); // asset names t20..t199; inputs always have a lower number, so the graph is acyclic
    var picks = new[] { Random(outId), Random(outId) };
    var inputs = picks.Distinct().Select(i => $"t{i}").ToList();
    var ev = new RunEvent($"e{k}", inputs, new List<string> { $"t{outId}" });
    for (int delivery = 0; delivery < 2; delivery++) if (catalog.Ingest(ev)) accepted++; // every event arrives twice
}
Console.WriteLine($"events accepted: {accepted} of 600 deliveries, edges: {catalog.Edges.Count}");

Dictionary<string, int> Hops(int limit) => catalog.Reach(catalog.Down, "t0", limit);
Console.WriteLine($"t0 impact: {Hops(1).Count} at 1 hop, {Hops(2).Count} within 2 hops, {Hops(AllHops).Count} in all");
Console.WriteLine($"t0 is {Hops(AllHops).Values.Max()} hops from its farthest consumer, and {catalog.Reach(catalog.Up, "t199", AllHops).Count} assets feed t199");

var teams = Hops(AllHops).Keys.Select(n => $"team-{int.Parse(n.Substring(1)) % Teams}").Distinct().OrderBy(t => t, StringComparer.Ordinal);
Console.WriteLine($"teams to notify: {string.Join(", ", teams)}");
Console.WriteLine($"search \"t1\": {string.Join(", ", catalog.Search("t1").Take(3))}");

// Check against the slow, obvious method: keep relaxing every edge until nothing changes.
var slow = new HashSet<string> { "t0" };
for (bool changed = true; changed;)
{
    changed = false;
    foreach (var (a, b) in catalog.Edges) if (slow.Contains(a) && !slow.Contains(b)) { slow.Add(b); changed = true; }
}
slow.Remove("t0");
bool same = slow.Count == Hops(AllHops).Count && slow.All(n => Hops(AllHops).ContainsKey(n));
catalog.Ingest(new RunEvent("cycle", new List<string> { "t150" }, new List<string> { "t0" })); // a feedback loop must not hang the walk
bool survives = Hops(AllHops).Count == slow.Count;
Console.WriteLine($"matches the slow method: {same.ToString().ToLower()}; survives a cycle: {survives.ToString().ToLower()}");
if (!same || !survives || accepted != Events) Environment.Exit(1);

record RunEvent(string Id, List<string> Inputs, List<string> Outputs);

class Catalog
{
    const int ExactMatchBonus = 1000, PerConsumer = 10; // search ranking weights
    HashSet<string> seen = new();
    public List<(string, string)> Edges = new();
    public Dictionary<string, List<string>> Down = new();
    public Dictionary<string, List<string>> Up = new();

    static void Link(Dictionary<string, List<string>> map, string a, string b)
    {
        if (!map.TryGetValue(a, out var list)) map[a] = list = new List<string>();
        list.Add(b);
    }

    // One run event says which assets a job read and wrote. A repeated event id is ignored.
    public bool Ingest(RunEvent ev)
    {
        if (!seen.Add(ev.Id)) return false;
        foreach (var o in ev.Outputs)
            foreach (var i in ev.Inputs)
            {
                if (Down.TryGetValue(i, out var known) && known.Contains(o)) continue; // the edge is already known
                Edges.Add((i, o)); Link(Down, i, o); Link(Up, o, i);
            }
        return true;
    }

    // Breadth-first walk with a depth limit; a visited map makes cycles harmless. Returns asset -> hops from the start.
    public Dictionary<string, int> Reach(Dictionary<string, List<string>> map, string start, int maxDepth)
    {
        var hops = new Dictionary<string, int> { [start] = 0 };
        var frontier = new List<string> { start };
        for (int d = 1; d <= maxDepth && frontier.Count > 0; d++)
        {
            var next = new List<string>();
            foreach (var u in frontier)
                if (map.TryGetValue(u, out var vs))
                    foreach (var v in vs) if (hops.TryAdd(v, d)) next.Add(v);
            frontier = next;
        }
        hops.Remove(start);
        return hops;
    }

    public List<string> Search(string query)
    {
        var names = Edges.SelectMany(e => new[] { e.Item1, e.Item2 }).Distinct();
        int Score(string n) => (n == query ? ExactMatchBonus : 0) + PerConsumer * (Down.TryGetValue(n, out var l) ? l.Count : 0);
        return names.Where(n => n.Contains(query)).OrderByDescending(Score).ThenBy(n => n, StringComparer.Ordinal).ToList();
    }
}
