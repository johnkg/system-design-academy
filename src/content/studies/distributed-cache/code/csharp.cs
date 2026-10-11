// A cache cluster in C#, in four small parts:
// 1) a consistent-hash ring with virtual nodes, 2) an LRU cache with a memory limit and TTLs,
// 3) single flight against a stampede, 4) TTL jitter against a mass expiry.
using System;
using System.Collections.Generic;
using System.Linq;

// A key expires at 100 ms; one request per millisecond arrives until 200 ms, and a database load takes 40 ms.
static int Stampede(bool singleFlight)
{
    int loads = 0, ready = int.MaxValue; bool started = false;
    for (int t = 100; t < 200; t++)
    {
        if (t >= ready) continue;                 // refilled: a hit
        if (singleFlight && started) continue;    // waits for the load already running
        loads++; started = true; ready = Math.Min(ready, t + 40);
    }
    return loads;
}

static int Peak(List<string> keys, bool jitter)
{
    var perSecond = new Dictionary<long, int>();
    foreach (var k in keys.Take(1000))
    {
        long ttl = 300000 + (jitter ? (long)(Ring.Hash(k) % 60000) - 30000 : 0); // +/- 10%
        long s = ttl / 1000;
        perSecond[s] = perSecond.GetValueOrDefault(s) + 1;
    }
    return perSecond.Values.Max();
}

static string Shown(int? v) => v.HasValue ? v.Value.ToString() : "miss";

var keys = Enumerable.Range(0, 10000).Select(i => $"user:{i}").ToList();

var ring4 = new Ring(4, 100); var ring5 = new Ring(5, 100);
var load = new int[4];
var before = new List<int>();
foreach (var k in keys) { int n = ring4.Owner(k); load[n]++; before.Add(n); }
Console.WriteLine($"keys per node on 4 nodes x 100 vnodes: {string.Join(", ", load)}");
int moved = 0, modMoved = 0; bool toNew = true;
for (int i = 0; i < keys.Count; i++)
{
    int after = ring5.Owner(keys[i]);
    if (after != before[i]) { moved++; if (after != 4) toNew = false; }
    if (Ring.Hash(keys[i]) % 4 != Ring.Hash(keys[i]) % 5) modMoved++;
}
Console.WriteLine($"adding a 5th node moves {moved} keys on the ring, all to the new node: {toNew.ToString().ToLower()}; hash mod N would move {modMoved}");

var cache = new Cache(3);
cache.Set("a", 1, 0, 100); cache.Set("b", 2, 0, 100); cache.Set("c", 3, 0, 100);
cache.Get("a", 10);                  // a is now the newest, so b is the oldest
cache.Set("d", 4, 20, 100);          // over the limit: b is evicted
Console.WriteLine($"evicted: {string.Join(",", cache.Evicted)}; a={Shown(cache.Get("a", 30))}, b={Shown(cache.Get("b", 30))}; a after its TTL={Shown(cache.Get("a", 150))}");

int plain = Stampede(false), single = Stampede(true);
Console.WriteLine($"database loads while refilling: {plain} without protection, {single} with single flight");

int flat = Peak(keys, false), spread = Peak(keys, true);
Console.WriteLine($"1000 keys cached together: most expiries in one second is {flat} without jitter, {spread} with it");

bool ok = toNew && moved < 3000 && modMoved > 7000 && load.Min() > 2000 && plain == 40 && single == 1 && flat == 1000 && spread < 50
    && string.Join(",", cache.Evicted) == "b" && cache.Get("b", 30) == null;
if (!ok) Environment.Exit(1);

class Ring
{
    readonly List<(uint pos, int node)> points = new();
    public Ring(int nodeCount, int vnodes)
    {
        for (int n = 0; n < nodeCount; n++)
            for (int v = 0; v < vnodes; v++) points.Add((Hash($"node{n}#{v}"), n));
        points.Sort((a, b) => a.pos != b.pos ? a.pos.CompareTo(b.pos) : a.node.CompareTo(b.node));
    }
    // A 32-bit hash: FNV-1a, then a final mix so that similar strings land far apart.
    public static uint Hash(string s)
    {
        uint h = 0x811c9dc5;
        foreach (char c in s) { h ^= c; h = unchecked(h * 16777619u); }
        h ^= h >> 16; h = unchecked(h * 0x85ebca6bu); h ^= h >> 13; h = unchecked(h * 0xc2b2ae35u); h ^= h >> 16;
        return h;
    }
    public int Owner(string key)   // the first point clockwise from the key, wrapping around
    {
        uint h = Hash(key);
        int lo = 0, hi = points.Count;
        while (lo < hi) { int mid = (lo + hi) / 2; if (points[mid].pos < h) lo = mid + 1; else hi = mid; }
        return points[lo % points.Count].node;
    }
}

// An LRU cache with a limit on the number of entries and a time to live. The linked list keeps the newest use at the end.
class Cache
{
    readonly int capacity;
    readonly Dictionary<string, LinkedListNode<(string key, int value, int expires)>> map = new();
    readonly LinkedList<(string key, int value, int expires)> order = new();
    public List<string> Evicted { get; } = new();
    public Cache(int capacity) { this.capacity = capacity; }
    void Remove(string key) { if (map.Remove(key, out var node)) order.Remove(node); }
    public int? Get(string key, int now)
    {
        if (!map.TryGetValue(key, out var node)) return null;
        var e = node.Value;
        Remove(key);
        if (e.expires <= now) return null;        // expired: behaves as a miss
        map[key] = order.AddLast(e);              // a use moves it to the newest end
        return e.value;
    }
    public void Set(string key, int value, int now, int ttl)
    {
        Remove(key);
        map[key] = order.AddLast((key, value, now + ttl));
        while (map.Count > capacity) { var oldest = order.First!.Value.key; Remove(oldest); Evicted.Add(oldest); }
    }
}
