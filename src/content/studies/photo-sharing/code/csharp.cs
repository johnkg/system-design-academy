// Likes on a viral photo, in C#:
// a unique (post, user) row keeps repeated taps out, the counter is split over shards so no row is hot,
// and writes to the counter are batched, so the database sees a few big additions instead of thousands of small ones.
using System;
using System.Collections.Generic;
using System.Linq;

public class LikeStore
{
    const int Shards = 8, Batch = 500;
    const long KeySpace = 100000; // a like key packs post and user: post * 100000 + user, with user ids below 100000
    readonly HashSet<long> liked = new();                                // the unique (post, user) rows: a repeat is rejected here
    readonly Dictionary<int, int[]> shards = new();                      // post -> counter shards, each one a separate row in the database
    readonly Dictionary<(int Post, int Shard), int> pending = new();     // likes waiting in the buffer
    public readonly Dictionary<(int Post, int Shard), int> RowWrites = new(); // updates each row received
    int waiting;
    public int CounterWrites;                                            // updates that reached a counter row

    public bool Like(int post, int user, int pick)
    {
        long key = post * KeySpace + user;
        if (!liked.Add(key)) return false;                               // the unique constraint says: already liked
        var slot = (post, pick % Shards);                                // any shard will do, so choose by a random number
        pending[slot] = pending.GetValueOrDefault(slot) + 1;
        if (++waiting >= Batch) Flush();
        return true;
    }

    public void Flush()                                                  // one update per (post, shard) that changed, however many likes it holds
    {
        foreach (var (slot, n) in pending)
        {
            if (!shards.ContainsKey(slot.Post)) shards[slot.Post] = new int[Shards];
            shards[slot.Post][slot.Shard] += n;
            CounterWrites++;
            RowWrites[slot] = RowWrites.GetValueOrDefault(slot) + 1;
        }
        pending.Clear(); waiting = 0;
    }

    public int Shown(int post) => shards.TryGetValue(post, out var s) ? s.Sum() : 0; // the count a reader sees: the sum of the shards
}

public static class Program
{
    const int Taps = 30000, Users = 20000, PickRange = 1000;
    const int ViralIn10 = 8; // 80% of the taps go to the viral post 0
    const int MaxWriteShare = 10; // batching must cut counter writes at least tenfold
    const ulong Seed = 4242;
    static ulong seed = Seed;
    static int Random(int n) { seed = (seed * 1664525UL + 1013904223UL) % 4294967296UL; return (int)((seed / 65536) % (ulong)n); }

    public static int Main()
    {
        var store = new LikeStore();
        int[] posts = { 0, 1, 2 };
        int SumShown() => posts.Sum(p => store.Shown(p));
        var taps = new List<(int Post, int User)>();                     // every tap, including repeats
        int accepted = 0, behindMax = 0;
        for (int i = 0; i < Taps; i++)
        {
            int post = Random(10) < ViralIn10 ? 0 : 1 + Random(posts.Length - 1);              // 80% of the taps go to the viral post 0
            int user = Random(Users);
            taps.Add((post, user));
            if (store.Like(post, user, Random(PickRange))) accepted++;
            behindMax = Math.Max(behindMax, accepted - SumShown());      // likes in the buffer, not yet in the counters
        }
        int lastBehind = accepted - SumShown();
        store.Flush();

        var truth = posts.Select(p => taps.Where(t => t.Post == p).Select(t => t.User).Distinct().Count()).ToArray(); // the slow, obvious count
        var shown = posts.Select(store.Shown).ToArray();
        Console.WriteLine($"taps: {taps.Count}, counted once each: {accepted}, repeats rejected: {taps.Count - accepted}");
        Console.WriteLine($"true counts: {string.Join(", ", truth)}; counts after the last flush: {string.Join(", ", shown)}");
        Console.WriteLine($"the count trailed by at most {behindMax} likes, and by {lastBehind} just before the final flush");
        int hottest = store.RowWrites.Where(kv => kv.Key.Post == 0).Max(kv => kv.Value);
        Console.WriteLine($"counter writes: {store.CounterWrites} instead of {accepted}; the hottest row got {hottest}, a single row would have got {truth[0]}");

        bool ok = shown.SequenceEqual(truth) && accepted == truth.Sum() && store.CounterWrites < accepted / MaxWriteShare;
        return ok ? 0 : 1;
    }
}
