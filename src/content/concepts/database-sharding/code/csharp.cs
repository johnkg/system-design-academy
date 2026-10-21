// Sharding in C#: route keys to shards by hash, and measure what resharding costs.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const int Shards = 3, NewShards = 4, Users = 1000;
    const int FrEvery = 4; // every 4th user lives in FR

    public static void Main()
    {
        var store = new ShardedStore(Shards);
        for (int id = 1; id <= Users; id++) store.Put(id, new User(id, id % FrEvery == 0 ? "FR" : "US"));

        Console.WriteLine("rows per shard: " + string.Join(", ", store.Sizes()));
        Console.WriteLine($"user 42 is on shard {Sharding.ShardFor(42, Shards)} -> {store.Get(42)!.Country}");
        Console.WriteLine("users in FR (scatter-gather): " + store.CountWhere(u => u.Country == "FR"));

        int moved = 0;
        for (int id = 1; id <= Users; id++) if (Sharding.ShardFor(id, Shards) != Sharding.ShardFor(id, NewShards)) moved++;
        Console.WriteLine($"going from 3 to 4 shards moves {moved * 100.0 / Users}% of keys");
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
