// Two techniques from Discord's message storage story, as a small model in C# (not Discord's code):
// 1. Time-bucketed partitions: messages are stored under (channel, bucket), so no partition grows for ever, and a
//    "latest messages" query walks buckets from newest to oldest.
// 2. Request coalescing: readers of the same row who arrive while a read is already running join it instead of
//    starting their own, and routing by channel sends them all to the same service instance.
// Time is simulated (days for buckets, milliseconds for reads), so every run prints the same thing.
using System;
using System.Collections.Generic;
using System.Linq;

public record Channel(string Name, int CreatedDay, long Every, long From, int[]? Days);

public static class Program
{
    const long DayMs = 86400000;
    const int BucketDays = 10; // the window Discord described in 2017 for keeping partitions under 100 MB
    const long BucketMs = BucketDays * DayMs;
    const int NowDay = 99;
    const int DbMs = 20;
    const int Instances = 3;
    static readonly int[] Arrivals = { 0, 4, 9, 15, 22, 30, 41, 55 }; // ms at which readers of the channel's newest row arrive

    static long BucketOf(long ts) => ts / BucketMs;

    // The store: "channel:bucket" -> message timestamps, oldest first.
    static readonly Dictionary<string, List<long>> Store = new();

    static void Put(string channel, long ts)
    {
        var key = $"{channel}:{BucketOf(ts)}";
        if (!Store.ContainsKey(key)) Store[key] = new List<long>();
        Store[key].Add(ts);
    }

    // The newest `limit` messages: start in the current bucket, go back until enough are found or the channel's first bucket is passed.
    static (int Found, int Partitions, int Empty) Latest(Channel c, int limit)
    {
        int found = 0, partitions = 0, empty = 0;
        for (long b = BucketOf(NowDay * DayMs); b >= BucketOf(c.CreatedDay * DayMs) && found < limit; b--)
        {
            var rows = Store.TryGetValue($"{c.Name}:{b}", out var r) ? r : new List<long>();
            partitions++;
            if (rows.Count == 0) empty++;
            found += Math.Min(rows.Count, limit - found);
        }
        return (found, partitions, empty);
    }

    static int HashOf(string s)
    {
        int h = 7;
        foreach (var ch in s) h = (h * 31 + ch) % 1000003;
        return h;
    }

    static int DatabaseReads(Func<int, int> route, bool coalesce)
    {
        var running = new Dictionary<string, int>(); // "instance:row" -> time the read in progress finishes
        int reads = 0;
        for (int i = 0; i < Arrivals.Length; i++)
        {
            int t = Arrivals[i];
            var key = $"{route(i)}:busy-announcements:{BucketOf(NowDay * DayMs)}";
            if (coalesce && running.TryGetValue(key, out var finish) && finish > t) continue; // join the read in progress
            reads++;
            running[key] = t + DbMs;
        }
        return reads;
    }

    static int ByChannel(int i) => HashOf("busy-announcements") % Instances; // same channel, same instance
    static int AnyInstance(int i) => i % Instances; // readers spread round robin

    public static int Main()
    {
        var channels = new[]
        {
            new Channel("busy-announcements", 0, 6 * 3600000L, 40 * DayMs, null), // a message every 6 hours since day 40
            new Channel("quiet-friends", 5, 0, 0, new[] { 12, 33, 71 }), // three messages in all
        };
        foreach (var c in channels)
        {
            if (c.Days != null) foreach (var d in c.Days) Put(c.Name, d * DayMs);
            else for (long ts = c.From; ts < NowDay * DayMs; ts += c.Every) Put(c.Name, ts);
        }

        Console.WriteLine($"bucket window {BucketDays} days, today is day {NowDay} (bucket {BucketOf(NowDay * DayMs)})");
        foreach (var c in channels)
        {
            int size = Store.Where(kv => kv.Key.StartsWith(c.Name + ":")).Select(kv => kv.Value.Count).DefaultIfEmpty(0).Max();
            var (found, partitions, empty) = Latest(c, 25);
            Console.WriteLine($"{c.Name}: largest partition {size} messages; latest 25 -> found {found}, read {partitions} partitions ({empty} empty)");
        }

        // Request coalescing. Eight readers ask for the same row; one database read takes 20 ms.
        Console.WriteLine($"{Arrivals.Length} readers of one row, database read {DbMs} ms, {Instances} service instances");
        Console.WriteLine($"  no coalescing: {DatabaseReads(AnyInstance, false)} database reads");
        Console.WriteLine($"  coalescing, readers spread over instances: {DatabaseReads(AnyInstance, true)} database reads");
        Console.WriteLine($"  coalescing, routed by channel to instance {ByChannel(0)}: {DatabaseReads(ByChannel, true)} database reads");

        return DatabaseReads(ByChannel, true) >= DatabaseReads(AnyInstance, true) ? 1 : 0;
    }
}
