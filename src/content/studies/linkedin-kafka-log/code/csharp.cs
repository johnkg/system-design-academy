// Three ideas from LinkedIn's 2014 post on Kafka, as a small model in C# (not LinkedIn's or Kafka's code):
// 1. A topic is a set of append-only logs (partitions). A key picks the partition and each record gets an offset.
// 2. Consumers share one log. Each keeps its own position, commits it now and then, and a replacement resumes from the commit.
// 3. A follower copy lags the leader. Consumers only see records every copy has, and the acknowledgement mode decides
//    what the producer was promised before the leader is lost.
// Everything is deterministic, so every run prints the same thing.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const int Partitions = 3;
    const int CommitEvery = 4;

    static int HashOf(string key)
    {
        int h = 7;
        foreach (var ch in key) h = (h * 31 + ch) % 1000003;
        return h;
    }

    static (List<int> Seen, int Committed) Consume(int start, int upTo, int crashAfter)
    {
        var seen = new List<int>();
        int committed = start;
        for (int offset = start; offset < upTo; offset++)
        {
            if (seen.Count == crashAfter) break;
            seen.Add(offset);
            if ((offset + 1) % CommitEvery == 0) committed = offset + 1;
        }
        return (seen, committed);
    }

    public static int Main()
    {
        // 1. Keys, partitions and offsets.
        var logs = Enumerable.Range(0, Partitions).Select(_ => new List<string>()).ToArray();
        var sends = new[] { "ann", "bob", "hal", "ann", "jo", "bob", "ann", "hal" };
        foreach (var key in sends) logs[HashOf(key) % Partitions].Add(key);
        Console.WriteLine($"{sends.Length} records over {Partitions} partitions");
        for (int p = 0; p < logs.Length; p++)
            Console.WriteLine($"  partition {p}: offsets 0..{logs[p].Count - 1} hold [{string.Join(", ", logs[p])}]");
        var annPartitions = Enumerable.Range(0, Partitions).Where(p => logs[p].Contains("ann")).ToList();
        Console.WriteLine($"  every record for key ann is in {annPartitions.Count} partition");

        // 2. One shared log, two consumers with their own positions, and a crash.
        const int sharedLength = 10;
        var reporting = Consume(0, sharedLength, int.MaxValue).Seen;
        var worker = Consume(0, sharedLength, 6); // processes offsets 0..5, then crashes
        var replacement = Consume(worker.Committed, sharedLength, int.MaxValue).Seen;
        var again = worker.Seen.Where(o => replacement.Contains(o)).ToList();
        Console.WriteLine($"log of {sharedLength} records, stored once for both consumers");
        Console.WriteLine($"  reporting job read {reporting.Count} records, offsets {reporting[0]}..{reporting[^1]}");
        Console.WriteLine($"  worker crashed after offset {worker.Seen[^1]} with offset {worker.Committed} committed");
        Console.WriteLine($"  replacement starts at offset {replacement[0]} and sees offset {string.Join(", ", again)} a second time");

        // 3. A leader with 10 records, a follower that has fetched 7, and a lost leader.
        int leader = 10, follower = 7;
        int visible = Math.Min(leader, follower);
        Console.WriteLine($"leader holds {leader} records, follower holds {follower}, consumers can read offsets 0..{visible - 1}");
        foreach (var mode in new[] { "leader only", "all in-sync copies" })
        {
            int acknowledged = mode == "leader only" ? leader : follower;
            int lost = Math.Max(0, acknowledged - follower);
            Console.WriteLine($"  ack = {mode}: producer told {acknowledged} are safe, leader lost, {lost} acknowledged records gone");
        }

        return annPartitions.Count != 1 || again.Count != 2 || visible != 7 ? 1 : 0;
    }
}
