// A Kafka-style partitioned log in C#:
// keys pick a partition, each partition is an append-only log with a leader and followers, and a leader crash shows what each acks setting loses.
using System;
using System.Collections.Generic;
using System.Linq;

public record Result(int Acked, int Kept, List<int> Lost, int Dups, List<int> Log);

public class Partition
{
    public readonly List<int>[] Logs;
    readonly bool[] alive;
    public int Leader;
    public Partition(int replicas) { Logs = Enumerable.Range(0, replicas).Select(_ => new List<int>()).ToArray(); alive = Enumerable.Repeat(true, replicas).ToArray(); Leader = 0; }
    public void Append(int id, bool idempotent) { var log = Logs[Leader]; if (idempotent && log.Contains(id)) return; log.Add(id); } // a broker remembers each producer's last sequence number; Contains stands in
    public void Fetch() { for (int r = 0; r < Logs.Length; r++) if (r != Leader && alive[r]) { Logs[r].Clear(); Logs[r].AddRange(Logs[Leader]); } } // followers catch up to the leader
    public void Crash() { alive[Leader] = false; Leader = -1; }
    public void Elect() { Leader = Array.IndexOf(alive, true); } // the first in-sync replica takes over; the others truncate to its log
}

public static class Program
{
    const int Partitions = 4, Users = 12, EventsPerUser = 5;
    const int Replicas = 3, Messages = 20, CrashAt = 14, NoticedAt = 16; // a fire-and-forget producer only notices the dead leader at message 16
    const int FetchEvery = 4, LostAckId = 9; // followers copy every 4th message; the ack of message 9 is lost
    const int Batch = 5, CrashAfter = 3; // the consumer crashes after processing 3 of a batch of 5
    static uint Fnv(string s) { uint h = 2166136261; foreach (char c in s) h = unchecked((h ^ c) * 16777619u); return h; } // FNV-1a, a stable hash
    static int PartitionFor(string key, int count) => (int)(Fnv(key) % (uint)count);

    // acks: 0, 1 or 2 (which stands for "all")
    static Result Run(int acks, bool idempotent)
    {
        var p = new Partition(Replicas); var acked = new List<int>();
        for (int id = 0; id < Messages; id++)
        {
            if (id == CrashAt) p.Crash();                                  // the leader dies while the producer is writing
            if (p.Leader < 0)
            {
                if (acks == 0 && id < NoticedAt) { acked.Add(id); continue; } // fire and forget: nobody tells the producer, and the message goes nowhere
                p.Elect(); p.Fetch();                                  // acks 1 or all: an error, a metadata refresh, and a retry on the new leader
            }
            p.Append(id, idempotent);
            if (acks == 2 || id % FetchEvery == FetchEvery - 1) p.Fetch();                  // acks=all waits for the followers, otherwise they copy in batches
            if (id == LostAckId && acks != 0) p.Append(id, idempotent);        // the ack was lost on the network, so the producer retries
            acked.Add(id);
        }
        var kept = p.Logs[p.Leader];
        var lost = acked.Where(id => !kept.Contains(id)).ToList();
        return new Result(acked.Count, kept.Count, lost, kept.Count - kept.Distinct().Count(), kept);
    }

    static void Show(string label, Result r) => Console.WriteLine($"{label}: acked {r.Acked}, in log {r.Kept}, acked but lost [{string.Join(" ", r.Lost)}], duplicates {r.Dups}");

    // A consumer group member: the committed offset decides what happens after a crash.
    static (int Missing, int Repeated) Consume(List<int> log, bool commitFirst)
    {
        int committed = 0; var processed = new List<int>();
        var batch = log.Skip(committed).Take(Batch).ToList();
        if (commitFirst) committed += batch.Count;                     // commit, then process
        processed.AddRange(batch.Take(CrashAfter));                            // crash after 3 messages
        processed.AddRange(log.Skip(committed));                       // the restarted consumer resumes at the committed offset
        return (log.Count(id => !processed.Contains(id)), processed.Count - processed.Distinct().Count());
    }

    public static int Main()
    {
        // ---- 1. Keys decide the partition, so one key's events stay in order ----
        var parts = Enumerable.Range(0, Partitions).Select(_ => new List<(string Key, int N)>()).ToArray();
        for (int n = 0; n < EventsPerUser; n++) for (int u = 0; u < Users; u++) { var key = $"user-{u}"; parts[PartitionFor(key, Partitions)].Add((key, n)); }
        bool inOrder = parts.All(log => { var last = new Dictionary<string, int>(); return log.All(e => { bool ok = last.GetValueOrDefault(e.Key, -1) < e.N; last[e.Key] = e.N; return ok; }); });
        Console.WriteLine($"partition sizes: {string.Join(", ", parts.Select(l => l.Count))}; every key in order: {inOrder.ToString().ToLower()}");

        // ---- 2. One partition with three replicas ----
        var r0 = Run(0, false); var r1 = Run(1, false); var rAll = Run(2, false); var rIdem = Run(2, true);
        Show("acks=0          ", r0); Show("acks=1          ", r1); Show("acks=all        ", rAll); Show("acks=all + idem ", rIdem);

        // ---- 3. Committed offsets ----
        var before = Consume(rIdem.Log, true); var after = Consume(rIdem.Log, false);
        Console.WriteLine($"commit before processing: {before.Missing} missing, {before.Repeated} repeated");
        Console.WriteLine($"commit after processing:  {after.Missing} missing, {after.Repeated} repeated");

        bool ok = inOrder && rAll.Lost.Count == 0 && rIdem.Dups == 0 && rIdem.Log.Count == Messages && r1.Lost.Count > 0 && r0.Lost.Count > r1.Lost.Count && rAll.Dups == 1
            && before.Missing == 2 && after.Missing == 0 && after.Repeated == 3;
        return ok ? 0 : 1;
    }
}
