// An LRU cache and a coalescing loader. Time is counted in whole ticks so every run prints the same.
using System;
using System.Collections.Generic;
using System.Linq;

public class LruCache
{
    readonly int capacity;
    readonly Dictionary<string, LinkedListNode<(string Key, string Value)>> nodes = new();
    readonly LinkedList<(string Key, string Value)> order = new(); // first = oldest, last = newest

    public LruCache(int capacity) { this.capacity = capacity; }

    public string? Get(string key)
    {
        if (!nodes.TryGetValue(key, out var node)) return null;
        order.Remove(node);              // move the key to the newest end
        order.AddLast(node);
        return node.Value.Value;
    }

    // Stores a value. Returns the key it evicted, or null.
    public string? Put(string key, string value)
    {
        string? evicted = null;
        if (nodes.TryGetValue(key, out var existing)) { order.Remove(existing); nodes.Remove(key); }
        else if (nodes.Count >= capacity)
        {
            evicted = order.First!.Value.Key;
            nodes.Remove(evicted);
            order.RemoveFirst();
        }
        nodes[key] = order.AddLast((key, value));
        return evicted;
    }

    public IEnumerable<string> Keys() => order.Select(n => n.Key);
}

// With coalescing on, requests for a key that is already being loaded join that load instead of starting their own.
public class Loader
{
    const int Capacity = 3;          // entries the LRU cache holds
    const int LoadTicks = 3;         // a database load takes 3 ticks to finish

    readonly LruCache cache = new(Capacity);
    readonly bool coalesce;
    List<(string Key, int ReadyAt)> inFlight = new(); // database loads under way
    public int DbLoads, Hits, Joined;

    public Loader(bool coalesce) { this.coalesce = coalesce; }

    public void FinishLoads(int now)
    {
        foreach (var load in inFlight) if (load.ReadyAt <= now) cache.Put(load.Key, "fresh");
        inFlight = inFlight.Where(load => load.ReadyAt > now).ToList();
    }

    public void Request(string key, int now)
    {
        if (cache.Get(key) != null) { Hits++; return; }
        if (coalesce && inFlight.Any(load => load.Key == key)) { Joined++; return; }
        DbLoads++;
        inFlight.Add((key, now + LoadTicks));
    }
}

public static class Program
{
    const int Capacity = 3;              // entries the LRU cache holds
    const int FirstTick = 60;            // the hot key has just expired at this tick
    const int LastTick = 64;             // the demo stops after this tick
    const int RequestsPerTick = 5;       // requests for the hot key in each tick

    public static void Main()
    {
        // Part 1: LRU in action.
        var lru = new LruCache(Capacity);
        int hits = 0, misses = 0;
        foreach (var key in new[] { "A", "B", "C", "A", "D", "B", "A", "E" })
        {
            if (lru.Get(key) != null) { hits++; Console.WriteLine($"get {key}: hit"); continue; }
            misses++;
            var evicted = lru.Put(key, "value of " + key);
            Console.WriteLine($"get {key}: miss" + (evicted != null ? $", evicts {evicted}" : ""));
        }
        Console.WriteLine($"oldest to newest: {string.Join(" ", lru.Keys())}");
        Console.WriteLine($"hits {hits}, misses {misses}");

        // Part 2: the hot key has just expired and requests keep arriving.
        foreach (var coalesce in new[] { false, true })
        {
            var loader = new Loader(coalesce);
            int total = 0;
            for (int tick = FirstTick; tick <= LastTick; tick++)
            {
                loader.FinishLoads(tick);
                for (int i = 0; i < RequestsPerTick; i++) { loader.Request("home", tick); total++; }
            }
            Console.WriteLine($"coalescing {(coalesce ? "on " : "off")}: {total} requests, {loader.DbLoads} database loads, {loader.Joined} joined, {loader.Hits} hits");
        }
    }
}
