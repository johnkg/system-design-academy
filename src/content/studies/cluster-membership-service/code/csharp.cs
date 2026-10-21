// SWIM-style membership in C#: random probes, indirect probes, a suspicion state, incarnation numbers,
// updates piggybacked on the probe messages, and a consistent-hash ring that reacts to the verdicts.
using System;
using System.Collections.Generic;
using System.Linq;

const int N = Node.ClusterSize, Crash = 3, Slow = 7, CrashAt = 5, PauseAt = 20, PauseFor = 4, Rounds = 40;
const int Retransmit = 8, Piggyback = 4, Loss = 5; // each update is sent 8 times, 4 per message, 5% of messages are lost
const int Seed = 7;
const int Vnodes = 8; // ring tokens per member
const int TokenStride = 100; // member m's tokens are hashed from m * 100 + v
const int LongSuspect = 6; // rounds of suspicion: longer than the pause, then shorter
const int ShortSuspect = 2;
const int Keys = 1000; // keys placed on the ring
const int Alive = 0, Suspect = 1, Dead = 2;

uint seed = Seed;
int Rand(int n) { unchecked { seed = seed * 1664525u + 1013904223u; } return (int)((seed >> 16) % (uint)n); }
bool Running(int x, int t) => !(x == Crash && t >= CrashAt) && !(x == Slow && t >= PauseAt && t < PauseAt + PauseFor);

(int learnedAt, List<int> falseDead, int incSlow) Run(int suspectFor)
{
    seed = Seed;
    var nodes = Enumerable.Range(0, N).Select(id => new Node(id)).ToList();
    var everDead = new SortedSet<int>();
    int learnedAt = -1;

    void Queue(Node node, int who, int status, int inc)
    {
        node.Buffer.RemoveAll(u => u.Who == who);
        node.Buffer.Add(new Update(who, status, inc, Retransmit));
    }
    void Apply(Node node, Update u, int t)
    {
        if (u.Who == node.Id) { if (u.Status != Alive && u.Inc >= node.Inc) node.Refute = true; return; } // someone doubts me
        int w = u.Who;
        bool fresh = u.Status == Alive ? u.Inc > node.Known[w]
            : u.Status == Suspect ? node.Status[w] != Dead && (u.Inc > node.Known[w] || (u.Inc == node.Known[w] && node.Status[w] == Alive))
            : node.Status[w] != Dead && u.Inc >= node.Known[w];
        if (!fresh) return;
        node.Status[w] = u.Status; node.Known[w] = u.Inc; node.Since[w] = t;
        if (u.Status == Dead && w != Crash) everDead.Add(w);
        Queue(node, w, u.Status, u.Inc);
    }
    bool Send(int from, int to, int t) // one message with piggybacked updates; false if it was lost
    {
        var src = nodes[from];
        src.Buffer.Sort((a, b) => a.Left != b.Left ? b.Left.CompareTo(a.Left) : a.Who.CompareTo(b.Who));
        var items = src.Buffer.Take(Piggyback).ToList();
        foreach (var u in items) u.Left--;
        src.Buffer.RemoveAll(u => u.Left <= 0);
        if (Rand(100) < Loss) return false;
        foreach (var u in items) Apply(nodes[to], u, t);
        return true;
    }

    for (int t = 0; t < Rounds; t++)
    {
        foreach (var node in nodes)
        {
            if (!Running(node.Id, t)) continue;
            if (node.Refute) { node.Refute = false; node.Inc++; Queue(node, node.Id, Alive, node.Inc); } // refute with a higher incarnation
            var others = nodes.Where(n => n.Id != node.Id && node.Status[n.Id] != Dead).Select(n => n.Id).ToList();
            int target = others[Rand(others.Count)];
            bool ok = Send(node.Id, target, t) && Running(target, t) && Send(target, node.Id, t);
            if (!ok) // indirect probes through two other nodes
            {
                var helpers = others.Where(x => x != target).ToList();
                for (int k = 0; k < 2 && helpers.Count > 0; k++)
                {
                    int idx = Rand(helpers.Count), m = helpers[idx];
                    helpers.RemoveAt(idx);
                    if (Send(node.Id, m, t) && Running(m, t) && Send(m, target, t) && Running(target, t) && Send(target, m, t) && Send(m, node.Id, t)) ok = true;
                }
            }
            if (!ok) Apply(node, new Update(target, Suspect, node.Known[target], 0), t);
            for (int j = 0; j < N; j++)
                if (node.Status[j] == Suspect && t - node.Since[j] >= suspectFor) Apply(node, new Update(j, Dead, node.Known[j], 0), t);
        }
        if (learnedAt < 0 && t >= CrashAt && nodes.All(n => n.Id == Crash || n.Status[Crash] == Dead)) learnedAt = t - CrashAt;
    }
    return (learnedAt, everDead.ToList(), nodes[Slow].Inc);
}

// 32-bit integer hash finalizer (xor-shift-multiply)
uint Mix(uint x)
{
    unchecked
    {
        x = (x ^ (x >> 16)) * 0x45d9f3bu;
        x = (x ^ (x >> 16)) * 0x45d9f3bu;
        return x ^ (x >> 16);
    }
}
int Owner(int key, List<int> members) // first token at or after the key's hash, going clockwise
{
    uint h = Mix(unchecked((uint)(key * 31 + 5)));
    int best = -1, first = -1; uint bestTok = 0, firstTok = 0;
    foreach (int m in members)
        for (int v = 0; v < Vnodes; v++)
        {
            uint tok = Mix(unchecked((uint)(m * TokenStride + v)));
            if (tok >= h && (best < 0 || tok < bestTok)) { best = m; bestTok = tok; }
            if (first < 0 || tok < firstTok) { first = m; firstTok = tok; }
        }
    return best >= 0 ? best : first;
}

foreach (int suspectFor in new[] { LongSuspect, ShortSuspect })
{
    var (learned, falseDead, incSlow) = Run(suspectFor);
    Console.WriteLine($"suspicion {suspectFor}: crash known by every node {learned} rounds after it happened; healthy nodes declared dead: [{string.Join(",", falseDead)}]; slow node incarnation {incSlow}");
    if (learned < 0) Environment.Exit(1);
    if (suspectFor == LongSuspect && (falseDead.Count != 0 || incSlow < 1)) Environment.Exit(1); // the pause is shorter than the suspicion time, so it is refuted
    if (suspectFor == ShortSuspect && !falseDead.Contains(Slow)) Environment.Exit(1);             // a too-short suspicion time causes a false positive
}

var everyone = Enumerable.Range(0, N).ToList();
var before = Enumerable.Range(0, Keys).Select(k => Owner(k, everyone)).ToList();
int Moved(int gone) { var rest = everyone.Where(m => m != gone).ToList(); return Enumerable.Range(0, Keys).Count(k => Owner(k, rest) != before[k]); }
int Owned(int x) => before.Count(o => o == x);
Console.WriteLine($"ring: removing node {Crash} moves {Moved(Crash)} of 1000 keys, exactly the {Owned(Crash)} it owned");
Console.WriteLine($"ring: a false alarm on node {Slow} moves {Moved(Slow)} keys out and {Moved(Slow)} back");
if (Moved(Crash) != Owned(Crash) || Moved(Slow) != Owned(Slow) || Owned(Crash) == 0) Environment.Exit(1);

class Node
{
    public int Id, Inc; public bool Refute;
    public const int ClusterSize = 12;
    public int[] Status = new int[ClusterSize], Known = new int[ClusterSize], Since = new int[ClusterSize];
    public List<Update> Buffer = new();
    public Node(int id) { Id = id; }
}
class Update
{
    public int Who, Status, Inc, Left;
    public Update(int who, int status, int inc, int left) { Who = who; Status = status; Inc = inc; Left = left; }
}
