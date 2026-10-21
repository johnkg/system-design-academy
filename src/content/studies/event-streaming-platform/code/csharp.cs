// The core of an event streaming platform, in C#:
// keys pick a partition, an idempotent producer survives lost acknowledgements without duplicates,
// a consumer group resumes from committed offsets after a crash, and compaction keeps the latest value per key.
using System;
using System.Collections.Generic;
using System.Linq;

static uint Fnv(string s) { uint h = 2166136261; foreach (char c in s) h = unchecked((h ^ c) * 16777619); return h; }

const int Seed = 7, Events = 40, Keys = 7, Partitions = 3, LossPercent = 20;
const int CommitEvery = 4, CrashAfter = 11; // the consumer commits every 4 records and crashes after 11
long seed = Seed;
// Linear congruential generator (Numerical Recipes constants), high 16 bits.
int Roll() { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)((seed / 65536) % 100); } // 0..99, deterministic

(List<Partition> parts, int retries, int total) Produce(bool idempotent)
{
    // One producer sends 40 events. Every request or acknowledgement is lost 20% of the time, and the producer then retries.
    seed = Seed;
    var parts = Enumerable.Range(0, Partitions).Select(_ => new Partition()).ToList();
    var nextSeq = new int[Partitions];
    int retries = 0;
    for (int i = 0; i < Events; i++)
    {
        string key = $"user-{i % Keys}";
        int p = (int)(Fnv(key) % Partitions), seq = nextSeq[p]++;
        while (true)
        {
            if (Roll() < LossPercent) { retries++; continue; } // the request never arrived
            parts[p].Append(1, seq, key, i, idempotent);
            if (Roll() < LossPercent) { retries++; continue; } // it was stored, but the acknowledgement was lost
            break;
        }
    }
    return (parts, retries, parts.Sum(x => x.Log.Count));
}

var plain = Produce(false);
Console.WriteLine($"without idempotence: {plain.total} records stored for 40 sent, {plain.total - Events} duplicates, {plain.retries} retries");
var safe = Produce(true);
Console.WriteLine($"with idempotence: {safe.total} records stored for 40 sent, {safe.total - Events} duplicates, {safe.retries} retries");
Console.WriteLine($"partition sizes: {string.Join(' ', safe.parts.Select(x => x.Log.Count))}");

// Within each partition every key's values must be in the order they were sent.
bool inOrder = safe.parts.All(x =>
{
    var seen = new Dictionary<string, int>();
    foreach (var (key, value) in x.Log)
    {
        if (value <= seen.GetValueOrDefault(key, -1)) return false;
        seen[key] = value;
    }
    return true;
});

// A consumer group: member b owns partition 1 and commits after each batch of 4. It crashes after processing 11 records.
var log1 = safe.parts[1].Log;
int crashAt = Math.Min(CrashAfter, log1.Count), committed = crashAt / CommitEvery * CommitEvery;
int reread = log1.Count - committed;   // member a takes over and starts from the committed offset
int twice = crashAt - committed;
Console.WriteLine($"group: b processed {crashAt} records of partition 1 and committed {committed}; a resumed at {committed} and read {reread}, so {twice} were processed twice");

// Compaction keeps only the newest record for each key, in log order.
List<(string key, int value)> Compact(List<(string key, int value)> log)
{
    var lastAt = new Dictionary<string, int>();
    for (int i = 0; i < log.Count; i++) lastAt[log[i].key] = i;
    return log.Where((r, i) => lastAt[r.key] == i).ToList();
}
var kept = Compact(safe.parts[2].Log);
Console.WriteLine($"compaction of partition 2: {safe.parts[2].Log.Count} records -> {kept.Count}, kept {string.Join(' ', kept.Select(r => $"{r.key}={r.value}"))}");

bool ok = safe.total == Events && plain.total > Events && inOrder && twice == 3 && kept.Select(r => r.key).Distinct().Count() == kept.Count;
Console.WriteLine($"all invariants hold: {(ok ? "true" : "false")}");
return ok ? 0 : 1;

class Partition
{
    public List<(string key, int value)> Log = new();
    readonly Dictionary<int, int> lastSeq = new(); // the latest sequence number seen from each producer
    public string Append(int producerId, int seq, string key, int value, bool idempotent)
    {
        if (idempotent)
        {
            int last = lastSeq.GetValueOrDefault(producerId, -1);
            if (seq <= last) return "duplicate";        // a retry of something already stored: acknowledge it, store nothing
            if (seq > last + 1) return "out of order";  // a gap: refuse, so the producer must resend in order
            lastSeq[producerId] = seq;
        }
        Log.Add((key, value));
        return "appended";
    }
}
