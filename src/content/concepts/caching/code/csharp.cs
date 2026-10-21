// Caching in C#: an LRU cache with cache-aside reads.
using System;
using System.Collections.Generic;

public static class Program
{
    const int CacheCapacity = 2; // entries the cache holds before it evicts
    static readonly Database Db = new();
    static readonly LruCache<int, string> Cache = new(CacheCapacity);
    static int _hits;

    public static void Main()
    {
        foreach (int id in new[] { 1, 2, 1, 3, 1, 2 }) GetProduct(id);
        Console.WriteLine($"hits: {_hits}, database reads: {Db.Reads}"); // hits: 2, database reads: 4
    }

    static string GetProduct(int id) // cache-aside: check the cache, fall back to the database, then fill
    {
        if (Cache.TryGet(id, out var cached)) { _hits++; return cached!; }
        string row = Db.Load(id);
        Cache.Set(id, row);
        return row;
    }
}

public class Database
{
    public int Reads { get; private set; }
    public string Load(int id) { Reads++; return $"product-{id}"; }
}

public class LruCache<TKey, TValue>(int max) where TKey : notnull
{
    private readonly Dictionary<TKey, LinkedListNode<(TKey Key, TValue Value)>> _map = new();
    private readonly LinkedList<(TKey Key, TValue Value)> _order = new(); // first = most recently used

    public bool TryGet(TKey key, out TValue? value)
    {
        if (_map.TryGetValue(key, out var node))
        {
            _order.Remove(node);      // move to the front: most recently used
            _order.AddFirst(node);
            value = node.Value.Value;
            return true;
        }
        value = default;
        return false;
    }

    public void Set(TKey key, TValue value)
    {
        if (_map.TryGetValue(key, out var existing)) { _order.Remove(existing); _map.Remove(key); }
        else if (_map.Count >= max)
        {
            var oldest = _order.Last!;
            _order.RemoveLast();
            _map.Remove(oldest.Value.Key);
            Console.WriteLine($"  evicted {oldest.Value.Key}");
        }
        _map[key] = _order.AddFirst((key, value));
    }

    public void Delete(TKey key)
    {
        if (_map.Remove(key, out var node)) _order.Remove(node); // explicit invalidation
    }
}
