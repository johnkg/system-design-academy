// A sharded friend graph in C#:
// sorted adjacency lists, mutual friends by merging two lists, friend-of-friend with a cap on hubs, and bidirectional search.
using System;
using System.Collections.Generic;
using System.Linq;

const int Users = 500, Shards = 4, HubCap = 100;
var adj = Enumerable.Range(0, Users).Select(_ => new List<int>()).ToArray(); // each list stays sorted
int edges = 0, crossShard = 0;
int ShardOf(int u) => u % Shards; // the shard that owns user u's list

bool IsFriend(int a, int b) { int i = adj[a].BinarySearch(b); return i >= 0; }

void Connect(int a, int b) // a friendship is stored twice, once in each person's list, and these may be on two shards
{
    if (a == b || IsFriend(a, b)) return;
    adj[a].Insert(~adj[a].BinarySearch(b), b);
    adj[b].Insert(~adj[b].BinarySearch(a), a);
    edges++; if (ShardOf(a) != ShardOf(b)) crossShard++;
}

// Mutual friends: walk two sorted lists together. The cost is the sum of their lengths at most.
(List<int> Common, int Steps) Mutual(int a, int b)
{
    var x = adj[a]; var y = adj[b]; var common = new List<int>(); int i = 0, j = 0, steps = 0;
    while (i < x.Count && j < y.Count)
    {
        steps++;
        if (x[i] == y[j]) { common.Add(x[i]); i++; j++; } else if (x[i] < y[j]) i++; else j++;
    }
    return (common, steps);
}

// Friend-of-friend: count how many friends each stranger shares with u. Friends with more than `cap` friends are skipped.
(List<KeyValuePair<int, int>> Ranked, int Touched, int ShardCount) Suggest(int u, int cap)
{
    var count = new Dictionary<int, int>(); int touched = 0; var shards = new HashSet<int>();
    foreach (int f in adj[u])
    {
        if (adj[f].Count > cap) continue; // a hub would add thousands of weak candidates
        shards.Add(ShardOf(f));
        foreach (int g in adj[f]) { touched++; if (g != u && !IsFriend(u, g)) count[g] = count.GetValueOrDefault(g) + 1; }
    }
    var ranked = count.OrderByDescending(p => p.Value).ThenBy(p => p.Key).ToList();
    return (ranked, touched, shards.Count);
}

// Degrees of separation by plain breadth-first search, and by searching from both ends and meeting in the middle.
(int Dist, int Scanned) Bfs(int a, int b)
{
    var dist = new Dictionary<int, int> { [a] = 0 }; var queue = new List<int> { a }; int scanned = 0;
    while (queue.Count > 0 && !dist.ContainsKey(b))
    {
        var next = new List<int>();
        foreach (int u in queue) foreach (int v in adj[u]) { scanned++; if (!dist.ContainsKey(v)) { dist[v] = dist[u] + 1; next.Add(v); } }
        queue = next;
    }
    return (dist.GetValueOrDefault(b, -1), scanned);
}

(int Dist, int Scanned) Bidirectional(int a, int b)
{
    if (a == b) return (0, 0);
    var seen = new[] { new Dictionary<int, int> { [a] = 0 }, new Dictionary<int, int> { [b] = 0 } };
    var front = new[] { new List<int> { a }, new List<int> { b } }; int scanned = 0;
    while (front[0].Count > 0 && front[1].Count > 0)
    {
        int s = front[0].Count <= front[1].Count ? 0 : 1; // always grow the smaller side
        var mine = seen[s]; var other = seen[1 - s]; var next = new List<int>(); int best = int.MaxValue;
        foreach (int u in front[s]) foreach (int v in adj[u])
        {
            scanned++;
            if (other.TryGetValue(v, out int d)) best = Math.Min(best, mine[u] + 1 + d);
            if (!mine.ContainsKey(v)) { mine[v] = mine[u] + 1; next.Add(v); }
        }
        if (best < int.MaxValue) return (best, scanned);
        front[s] = next;
    }
    return (-1, scanned);
}

uint seed = 7; // a small deterministic generator, so every run builds the same graph
int Rnd(int n) { seed = unchecked(seed * 1664525u + 1013904223u); return (int)((seed >> 16) % (uint)n); }

for (int u = 3; u < Users; u++) // users 0, 1 and 2 are celebrities that 3 in 10 friendships point to
    for (int i = 0; i < 6; i++) Connect(u, Rnd(10) < 3 ? Rnd(3) : (u + 1 + Rnd(25)) % Users);

var degrees = adj.Select(l => l.Count).ToArray();
Console.WriteLine($"{Users} users, {edges} friendships, {crossShard} of them across shards, biggest list {degrees.Max()}, typical list {degrees[250]}");

var m = Mutual(250, 262);
Console.WriteLine($"mutual friends of 250 and 262: [{string.Join(", ", m.Common)}] after {m.Steps} steps (lists of {adj[250].Count} and {adj[262].Count})");

var noCap = Suggest(250, int.MaxValue); var capped = Suggest(250, HubCap);
string Show(List<KeyValuePair<int, int>> r) => string.Join(" ", r.Take(3).Select(p => $"{p.Key}x{p.Value}"));
Console.WriteLine($"suggestions for 250 without a cap: {Show(noCap.Ranked)}, edges read {noCap.Touched}, shards {noCap.ShardCount}");
Console.WriteLine($"suggestions for 250 with cap {HubCap}: {Show(capped.Ranked)}, edges read {capped.Touched}, shards {capped.ShardCount}");

int pairs = 0, sumPlain = 0, sumBoth = 0;
for (int i = 0; i < 200; i++)
{
    int a = i * 37 % Users, b = (i * 91 + 5) % Users; var p = Bfs(a, b); var q = Bidirectional(a, b);
    if (p.Dist != q.Dist || p.Dist < 0) { Console.WriteLine($"mismatch for {a} and {b}"); return 1; }
    pairs++; sumPlain += p.Scanned; sumBoth += q.Scanned;
}
Console.WriteLine($"{pairs} distance queries agree; edges scanned: plain {sumPlain}, bidirectional {sumBoth}");

bool symmetric = Enumerable.Range(0, Users).All(a => adj[a].All(b => IsFriend(b, a)) && adj[a].Zip(adj[a].Skip(1), (x, y) => x < y).All(t => t));
bool mutualOk = m.Common.All(c => IsFriend(250, c) && IsFriend(262, c)) && m.Common.Count == adj[250].Count(c => IsFriend(262, c));
Console.WriteLine($"lists symmetric and sorted: {symmetric.ToString().ToLower()}; mutual friends match the slow check: {mutualOk.ToString().ToLower()}");
return symmetric && mutualOk && sumBoth < sumPlain && capped.Touched < noCap.Touched ? 0 : 1;
