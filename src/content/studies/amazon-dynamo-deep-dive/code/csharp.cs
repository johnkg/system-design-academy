// A miniature of the ideas in the 2007 Dynamo paper, in C# (a teaching model, not Amazon's code): a key is hashed onto a
// ring, copied to the first N healthy nodes of its preference list (a sloppy quorum with a hinted stand-in), every update carries a
// vector clock, and a read that finds conflicting versions returns all of them for the application to merge.
// Everything is deterministic, so every run prints the same thing. All numbers are made up for teaching.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

const int N = 3; // replicas per key
const int R = 2; // replies a read waits for
const int W = 2; // acknowledgements a write waits for

var nodeNames = new[] { "A", "B", "C", "D", "E", "F" };

// 32-bit FNV-1a: a stand-in for the MD5 hash Dynamo puts on a key.
static uint Fnv(string text)
{
    uint h = 0x811C9DC5;
    foreach (var b in Encoding.UTF8.GetBytes(text)) h = unchecked((h ^ b) * 0x01000193);
    return h;
}

// The ring: each node sits at a position, and a key belongs to the first node clockwise from its own position.
var ring = nodeNames.Select(name => (Node: name, At: Fnv($"node-{name}"))).OrderBy(slot => slot.At).ToList();

List<string> PreferenceList(string key)
{
    var start = Math.Max(ring.FindIndex(slot => slot.At >= Fnv(key)), 0);
    return Enumerable.Range(0, ring.Count).Select(i => ring[(start + i) % ring.Count].Node).ToList();
}

// A vector clock maps a node to a counter. a descends from b when every counter in b is at most the one in a.
static bool Descends(Dictionary<string, int> a, Dictionary<string, int> b) => b.All(pair => a.GetValueOrDefault(pair.Key, 0) >= pair.Value);

static string Show(Dictionary<string, int> clock) => "{" + string.Join(",", clock.OrderBy(pair => pair.Key, StringComparer.Ordinal).Select(pair => $"{pair.Key}:{pair.Value}")) + "}";

var stores = nodeNames.ToDictionary(name => name, _ => new List<(string Value, Dictionary<string, int> Clock)>()); // node -> versions of the cart
var hints = new List<(string Holder, string Intended, (string Value, Dictionary<string, int> Clock) Version)>();

// A put goes to the first N healthy nodes of the preference list. A node that is down is replaced by the next healthy one,
// which keeps a hint so that it can hand the copy back.
(Dictionary<string, int> Clock, bool Accepted) Put(string value, Dictionary<string, int> clock, string coordinator, HashSet<string> downNodes, List<string> order)
{
    var next = new Dictionary<string, int>(clock) { [coordinator] = clock.GetValueOrDefault(coordinator, 0) + 1 };
    var version = (Value: value, Clock: next);
    var wanted = order.Take(N).ToList();
    var chosen = order.Where(name => !downNodes.Contains(name)).Take(N).ToList();
    foreach (var name in chosen)
    {
        stores[name] = stores[name].Where(old => !Descends(next, old.Clock)).Append(version).ToList();
        if (!wanted.Contains(name)) hints.Add((name, wanted.First(w => downNodes.Contains(w)), version));
    }
    var accepted = chosen.Count >= W;
    Console.WriteLine($"put {value} clock {Show(next)} stored on {string.Join("", chosen)}{(accepted ? ", accepted" : ", REFUSED")}");
    return (next, accepted);
}

// A get asks R nodes and keeps every version that no other version descends from.
List<(string Value, Dictionary<string, int> Clock)> Get(List<string> askNodes)
{
    var found = new Dictionary<string, (string Value, Dictionary<string, int> Clock)>();
    foreach (var name in askNodes.Take(R)) foreach (var v in stores[name]) found[Show(v.Clock)] = v;
    var everything = found.Values.ToList();
    return everything.Where(v => !everything.Any(o => Descends(o.Clock, v.Clock) && !Descends(v.Clock, o.Clock))).ToList();
}

var orderOfNodes = PreferenceList("cart-42");
var first = orderOfNodes[0];
var second = orderOfNodes[1];
var third = orderOfNodes[2];
Console.WriteLine($"--- preference list for cart-42: {string.Join("", orderOfNodes.Take(N))} (then {string.Join("", orderOfNodes.Skip(N))} as spares)");
Console.WriteLine($"--- {third} is down: writes still succeed, and {orderOfNodes[N]} keeps a hint");
var downSet = new HashSet<string> { third };
var (v1Clock, _) = Put("book", new Dictionary<string, int>(), first, new HashSet<string>(), orderOfNodes);
var (_, v2Ok) = Put("book,pen", v1Clock, first, downSet, orderOfNodes); // client 1 adds a pen, from the clock it read
var (_, v3Ok) = Put("book,mug", v1Clock, second, downSet, orderOfNodes); // client 2 adds a mug from the same older clock: a conflict

Console.WriteLine("--- read: two versions that neither descends from the other");
var seen = Get(new List<string> { first, second });
Console.WriteLine($"versions returned: {string.Join(" | ", seen.Select(v => v.Value).OrderBy(value => value, StringComparer.Ordinal))}");
var merged = string.Join(",", seen.SelectMany(v => v.Value.Split(',')).Distinct().OrderBy(item => item, StringComparer.Ordinal));
var context = new Dictionary<string, int>();
foreach (var v in seen) foreach (var pair in v.Clock) context[pair.Key] = Math.Max(context.GetValueOrDefault(pair.Key, 0), pair.Value);
var (_, v4Ok) = Put(merged, context, first, downSet, orderOfNodes);
Console.WriteLine($"after the merge a read returns {string.Join(" | ", Get(new List<string> { first, second }).Select(v => v.Value))}");

Console.WriteLine("--- hinted handoff when the node returns");
foreach (var hint in hints)
{
    stores[hint.Intended] = stores[hint.Intended].Where(old => !Descends(hint.Version.Clock, old.Clock)).Append(hint.Version).ToList();
    Console.WriteLine($"{hint.Holder} hands {hint.Version.Value} back to {hint.Intended}");
}
var holders = orderOfNodes.Take(N).Where(name => stores[name].Count == 1 && stores[name][0].Value == merged).ToList();
Console.WriteLine($"nodes holding the merged cart: {string.Join("", holders)}");
var ok = v2Ok && v3Ok && v4Ok && seen.Count == 2 && merged == "book,mug,pen" && holders.Count == N;
Console.WriteLine($"checks {(ok ? "passed" : "FAILED")}");
if (!ok) Environment.Exit(1);
