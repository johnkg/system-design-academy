// A leaderboard split over several shards, in C#:
// each shard keeps its players sorted, the top list is a merge of every shard's top list, and a player's rank is a sum of counts.
using System;
using System.Collections.Generic;
using System.Linq;

public record Entry(int Id, int Score);

public static class Rules
{
    // Better means a higher score, and when scores are equal, the lower player id (who got there first).
    public static bool Better(Entry a, Entry b) => a.Score > b.Score || (a.Score == b.Score && a.Id < b.Id);
    public static int Compare(Entry a, Entry b) => Better(a, b) ? -1 : 1;
}

public class Shard
{
    readonly List<Entry> sorted = new(); // best first
    public readonly Dictionary<int, int> ScoreOf = new();

    // Number of entries in this shard that are better than the given one (binary search, so it is fast with millions of entries).
    public int CountBetter(Entry entry)
    {
        int lo = 0, hi = sorted.Count;
        while (lo < hi) { int mid = (lo + hi) >> 1; if (Rules.Better(sorted[mid], entry)) lo = mid + 1; else hi = mid; }
        return lo;
    }

    public void Update(int id, int score)
    {
        if (ScoreOf.TryGetValue(id, out int old)) sorted.RemoveAt(CountBetter(new Entry(id, old))); // remove the old entry
        ScoreOf[id] = score;
        sorted.Insert(CountBetter(new Entry(id, score)), new Entry(id, score));                      // insert in its place
    }

    public List<Entry> Top(int k) => sorted.Take(k).ToList();
}

public class Leaderboard
{
    readonly Shard[] shards;
    public Leaderboard(int shardCount) { shards = Enumerable.Range(0, shardCount).Select(_ => new Shard()).ToArray(); }
    Shard ShardOf(int id) => shards[(int)((((uint)id * 2654435761u) >> 16) % (uint)shards.Length)]; // the high bits of the product are well mixed
    public void Update(int id, int score) => ShardOf(id).Update(id, score);

    // The best k overall must be among the best k of some shard, so asking each shard for k is enough.
    public List<Entry> Top(int k)
    {
        var merged = shards.SelectMany(s => s.Top(k)).ToList();
        merged.Sort(Rules.Compare);
        return merged.Take(k).ToList();
    }

    public int Rank(int id)
    {
        var entry = new Entry(id, ShardOf(id).ScoreOf[id]);
        return 1 + shards.Sum(s => s.CountBetter(entry));
    }
}

public static class Program
{
    static long seed = 2024;
    static int Random(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)(seed / 65536 % n); }

    public static int Main()
    {
        var board = new Leaderboard(5);
        var truth = new Dictionary<int, int>(); // the same scores kept the slow, obvious way, to check against
        for (int i = 0; i < 20000; i++) // 20,000 updates to 2,000 players, so most players are updated many times
        {
            int id = Random(2000), score = Random(1000);
            board.Update(id, score); truth[id] = score;
        }

        var all = truth.Select(kv => new Entry(kv.Key, kv.Value)).ToList();
        all.Sort(Rules.Compare);
        var top = board.Top(5);
        Console.WriteLine($"top 5: {string.Join(", ", top.Select(e => $"#{e.Id} ({e.Score})"))}");
        int probe = all[1234].Id;
        Console.WriteLine($"player #{probe} has score {truth[probe]} and rank {board.Rank(probe)}; the full sort says {1234 + 1}");

        bool sameTop = board.Top(100).SequenceEqual(all.Take(100));
        bool sameRank = all.Select((e, i) => (e, i)).All(t => t.i % 97 != 0 || board.Rank(t.e.Id) == t.i + 1); // spot-check every 97th player
        Console.WriteLine($"top 100 matches the full sort: {sameTop.ToString().ToLowerInvariant()}; ranks match: {sameRank.ToString().ToLowerInvariant()}");
        return !sameTop || !sameRank || board.Rank(probe) != 1235 ? 1 : 0;
    }
}
