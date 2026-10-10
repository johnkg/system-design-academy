// Sharding in C#: route keys to shards by hash, and measure what resharding costs.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        var store = new ShardedStore(3);
        for (int id = 1; id <= 1000; id++) store.Put(id, new User(id, id % 4 == 0 ? "FR" : "US"));

        Console.WriteLine("rows per shard: " + string.Join(", ", store.Sizes()));
        Console.WriteLine($"user 42 is on shard {Sharding.ShardFor(42, 3)} -> {store.Get(42)!.Country}");
        Console.WriteLine("users in FR (scatter-gather): " + store.CountWhere(u => u.Country == "FR"));

        int moved = 0;
        for (int id = 1; id <= 1000; id++) if (Sharding.ShardFor(id, 3) != Sharding.ShardFor(id, 4)) moved++;
        Console.WriteLine($"going from 3 to 4 shards moves {moved / 10.0}% of keys");
    }
}

public record User(int Id, string Country);

public static class Sharding
{
    // FNV-1a: a small, stable hash (the same result in every language).
    // (string.GetHashCode is randomised per process, so it must not be used for routing.)
    public static uint Hash(string text)
    {
        uint h = 2166136261;
        foreach (char c in text) { h ^= c; h *= 16777619; }
        return h;
    }

    public static int ShardFor(int userId, int shardCount) => (int)(Hash($"user:{userId}") % (uint)shardCount);
}

public class ShardedStore(int shardCount)
{
    private readonly List<Dictionary<int, User>> _shards = Enumerable.Range(0, shardCount).Select(_ => new Dictionary<int, User>()).ToList(); // one small "database" per shard

    public void Put(int id, User user) => _shards[Sharding.ShardFor(id, _shards.Count)][id] = user;
    public User? Get(int id) => _shards[Sharding.ShardFor(id, _shards.Count)].GetValueOrDefault(id); // touches ONE shard
    public IEnumerable<int> Sizes() => _shards.Select(s => s.Count);
    public int CountWhere(Func<User, bool> predicate) => _shards.Sum(s => s.Values.Count(predicate)); // scatter-gather
}
