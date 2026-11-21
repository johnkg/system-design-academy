// A cache in front of a database, tried with different eviction policies on the same 200,000 requests. 85% of the
// requests ask for 1,000 hot keys (some hotter than others) and 15% for one of 50,000 cold keys. In one variant a
// report job reads 20,000 old keys once, between request 80,000 and 120,000. In another the hot set moves to other keys
// at request 140,000. The requests come from a seeded generator, so the output never changes. Integers only.
using System;
using System.Collections.Generic;
using System.Linq;

// Keys in the order they were added, with O(1) add, remove and "give me the oldest": a hash map plus a linked list.
class OrderedSet
{
    readonly LinkedList<int> list = new();
    readonly Dictionary<int, LinkedListNode<int>> nodes = new();
    public int Count => nodes.Count;
    public bool Has(int key) => nodes.ContainsKey(key);
    public void Add(int key) => nodes[key] = list.AddLast(key);
    public void Remove(int key) { list.Remove(nodes[key]); nodes.Remove(key); }
    public int Oldest() => list.First!.Value;
    public void Clear() { list.Clear(); nodes.Clear(); }
}

public static class Program
{
    const int Requests = 200000;
    const int Hot = 1000, HotPct = 85;                // hot keys, and the share of requests that ask for them
    const int ColdBase = 5000, Cold = 50000;          // the cold keys: 5,000 up to 54,999
    const int ShiftBase = 2000;                       // after the shift the hot keys are 2,000 up to 2,999
    const int ScanBase = 100000;                      // keys read once by the report job
    const int ScanStart = 80000, ScanEnd = 120000;    // the report reads one new key every second request in this window
    const int ShiftAt = 140000;                       // the hot set moves here
    const int MemoryLimit = 10000;                    // entries an unbounded map can hold before the process is killed
    const long Seed = 20261121;

    static void Run(string name, string policy = "lru", int size = 2000, bool scan = false, bool shift = false, int ttl = 0)
    {
        // Park-Miller generator, the same in every language.
        long state = Seed;
        long Next() { state = state * 48271 % 2147483647; return state; }

        bool lfu = policy == "lfu";
        var order = new OrderedSet();                              // lru, fifo and unbounded: keys from oldest to newest
        var freq = new Dictionary<int, int>();                     // lfu: how often each key was used
        var buckets = new Dictionary<int, OrderedSet>();           // lfu: use count -> keys with that count, oldest first
        var born = new Dictionary<int, int>();                     // key -> request number when it was stored
        int minFreq = 1, count = 0, peak = 0, restarts = 0, evictions = 0, expired = 0, dbReads = 0;
        var hits = new int[4]; var asked = new int[4];             // before the scan, during it, in between, after the shift

        OrderedSet Bucket(int f) { if (!buckets.ContainsKey(f)) buckets[f] = new OrderedSet(); return buckets[f]; }
        void Remove(int key)
        {
            if (lfu)
            {
                int f = freq[key]; var b = buckets[f];
                b.Remove(key);
                if (b.Count == 0) buckets.Remove(f);
                freq.Remove(key);
            }
            else order.Remove(key);
            born.Remove(key);
            count--;
        }

        for (int i = 0; i < Requests; i++)
        {
            int key;
            if (scan && i >= ScanStart && i < ScanEnd && i % 2 == 0) key = ScanBase + (i - ScanStart) / 2;
            else if (Next() % 100 < HotPct)
            {
                int a = (int)(Next() % Hot), b = (int)(Next() % Hot);
                key = (shift && i >= ShiftAt ? ShiftBase : 0) + Math.Min(a, b);
            }
            else key = ColdBase + (int)(Next() % Cold);
            bool regular = key < ScanBase;
            int phase = i < ScanStart ? 0 : i < ScanEnd ? 1 : i < ShiftAt ? 2 : 3;

            bool found = lfu ? freq.ContainsKey(key) : order.Has(key);
            if (found && ttl > 0 && i - born[key] >= ttl) { expired++; Remove(key); found = false; }
            if (regular) asked[phase]++;
            if (found)
            {
                if (regular) hits[phase]++;
                if (lfu) // move to the next use count, at the newest end of its bucket
                {
                    int f = freq[key]; var bk = buckets[f];
                    bk.Remove(key);
                    if (bk.Count == 0) { buckets.Remove(f); if (minFreq == f) minFreq = f + 1; }
                    freq[key] = f + 1;
                    Bucket(f + 1).Add(key);
                }
                else if (policy == "lru") { order.Remove(key); order.Add(key); } // newest end
                continue;
            }
            dbReads++;
            if (policy == "none")
            {
                if (count >= MemoryLimit) { order.Clear(); born.Clear(); count = 0; restarts++; } // out of memory: restart, cache gone
            }
            else if (count >= size)
            {
                while (lfu && !buckets.ContainsKey(minFreq)) minFreq++;
                Remove(lfu ? buckets[minFreq].Oldest() : order.Oldest());
                evictions++;
            }
            if (lfu) { freq[key] = 1; Bucket(1).Add(key); minFreq = 1; } else order.Add(key);
            born[key] = i;
            count++;
            peak = Math.Max(peak, count);
        }

        int Pct(int h, int a) => a == 0 ? 0 : (int)((long)h * 100 / a);
        Console.WriteLine($"-- {name}");
        Console.WriteLine($"  hit rate of regular requests: {Pct(hits.Sum(), asked.Sum())}% overall; before the scan {Pct(hits[0], asked[0])}%, during it {Pct(hits[1], asked[1])}%, last stretch {Pct(hits[3], asked[3])}%");
        Console.WriteLine($"  database reads: {dbReads} of {Requests} requests, evictions {evictions}, expired {expired}");
        Console.WriteLine($"  entries: {count} at the end, {peak} at most; out-of-memory restarts {restarts}");
        if (policy != "none" && peak > size) throw new Exception("cache grew past its size");
    }

    public static void Main()
    {
        Run("unbounded map, no eviction", policy: "none");
        Run("FIFO, 2,000 entries", policy: "fifo");
        Run("LRU, 2,000 entries");
        Run("LRU, 2,000 entries, report scan", scan: true);
        Run("LFU, 2,000 entries, report scan", policy: "lfu", scan: true);
        Run("LFU, 1,000 entries, report scan, hot set moves", policy: "lfu", size: 1000, scan: true, shift: true);
        Run("LRU, 1,000 entries, report scan, hot set moves", size: 1000, scan: true, shift: true);
        Run("LRU, 2,000 entries, entries expire after 2,000 requests", ttl: 2000);
    }
}
