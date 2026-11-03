// A miniature of the ideas in Amazon's Dynamo paper (SOSP 2007), in C# (a teaching model, not Amazon's code):
// a ring of nodes, N=3 replicas, R=2 and W=2, a sloppy quorum with hinted handoff, and vector clocks that keep
// concurrent shopping-cart updates as siblings until a reader merges them. Everything is deterministic.

using System;
using System.Collections.Generic;
using System.Linq;

var nodes = new (string Name, int Pos)[] { ("A", 10), ("B", 30), ("C", 50), ("D", 70), ("E", 90) }; // position on a ring of 100 points
const int N = 3, R = 2, W = 2;
var down = new HashSet<string>();
var store = nodes.ToDictionary(n => n.Name, n => new List<Stored>());

int Position(string key) => key.Sum(ch => (int)ch) % 100;
List<string> Walk(string key) // every node, clockwise from the key's position
{
    int start = Math.Max(0, Array.FindIndex(nodes, n => n.Pos >= Position(key)));
    return Enumerable.Range(0, nodes.Length).Select(k => nodes[(start + k) % nodes.Length].Name).ToList();
}
List<string> Healthy(string key) => Walk(key).Where(n => !down.Contains(n)).ToList();
string Show(SortedDictionary<string, int> clock) => string.Join(",", clock.Select(p => $"{p.Key}:{p.Value}"));
bool Descends(SortedDictionary<string, int> a, SortedDictionary<string, int> b) =>
    b.All(p => (a.TryGetValue(p.Key, out var c) ? c : 0) >= p.Value);

void Put(string key, List<string> items, SortedDictionary<string, int> context, string? coordinator = null)
{
    var clock = new SortedDictionary<string, int>(context);
    string coord = coordinator ?? Healthy(key)[0];
    clock[coord] = (clock.TryGetValue(coord, out var old) ? old : 0) + 1;
    var owners = Walk(key).Take(N).ToList();
    var missing = new Queue<string>(owners.Where(n => down.Contains(n))); // owners that cannot take their copy
    var targets = Healthy(key).Take(N).ToList();
    foreach (var t in targets)
    {
        bool own = owners.Contains(t);
        var version = new Stored(key, clock, items, own ? null : missing.Dequeue());
        store[t] = store[t].Where(v => v.Key != key || !Descends(clock, v.Clock)).Append(version).ToList();
    }
    var hints = targets.Where(t => !owners.Contains(t)).ToList();
    string note = hints.Count > 0 ? $", hint kept on {string.Join(",", hints)}" : "";
    Console.WriteLine($"put {key} {string.Join("+", items)} via {coord} clock {Show(clock)}: {targets.Count} acks, {(targets.Count >= W ? "ok" : "FAILED")}{note}");
}

List<Stored> Get(string key)
{
    var seen = new List<Stored>();
    foreach (var n in Healthy(key).Take(R)) seen.AddRange(store[n].Where(v => v.Key == key));
    var kept = new List<Stored>();
    for (int i = 0; i < seen.Count; i++)
    {
        var v = seen[i];
        bool beaten = seen.Select((o, j) => (o, j)).Any(x =>
            (Descends(x.o.Clock, v.Clock) && Show(x.o.Clock) != Show(v.Clock)) || (Show(x.o.Clock) == Show(v.Clock) && x.j < i));
        if (!beaten) kept.Add(v);
    }
    Console.WriteLine($"get {key} from {string.Join(",", Healthy(key).Take(R))}: " + string.Join(" | ", kept.Select(v => $"[{string.Join("+", v.Items)}] {Show(v.Clock)}")));
    return kept;
}

void Handoff()
{
    foreach (var n in store.Keys.ToList())
        foreach (var v in store[n].ToList())
            if (v.HintFor != null && !down.Contains(v.HintFor) && !down.Contains(n))
            {
                store[v.HintFor].Add(v with { HintFor = null });
                store[n].Remove(v);
                Console.WriteLine($"handoff: {n} gave {v.Key} {Show(v.Clock)} back to {v.HintFor}");
            }
}

string cartKey = "cart:ann";
Console.WriteLine($"ring position {Position(cartKey)}, preference list {string.Join(",", Walk(cartKey).Take(N))}");
Put(cartKey, new List<string> { "book" }, new SortedDictionary<string, int>());
var cart = Get(cartKey)[0];
down.Add("B");
Console.WriteLine("B goes down");
Put(cartKey, cart.Items.Append("pen").ToList(), cart.Clock);
cart = Get(cartKey)[0];
down.Remove("B");
Console.WriteLine("B comes back");
Handoff();
Console.WriteLine("two clients both start from the same cart and write through different coordinators");
var baseCart = cart;
Put(cartKey, baseCart.Items.Append("mug").ToList(), baseCart.Clock, "A");
Put(cartKey, baseCart.Items.Append("lamp").ToList(), baseCart.Clock, "C");
var siblings = Get(cartKey);
var merged = siblings.SelectMany(v => v.Items).Distinct().OrderBy(i => i, StringComparer.Ordinal).ToList();
var mergedClock = new SortedDictionary<string, int>();
foreach (var v in siblings)
    foreach (var (k, c) in v.Clock)
        mergedClock[k] = Math.Max(mergedClock.TryGetValue(k, out var m) ? m : 0, c);
Console.WriteLine($"the reader merges {siblings.Count} siblings into {string.Join("+", merged)}");
Put(cartKey, merged, mergedClock);
Get(cartKey);

record Stored(string Key, SortedDictionary<string, int> Clock, List<string> Items, string? HintFor);
