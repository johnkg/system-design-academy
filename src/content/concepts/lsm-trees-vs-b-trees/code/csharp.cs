// A tiny LSM tree in C#: memtable, immutable sorted runs, bloom filters, tombstones and merge compaction.
// All numbers are integers so the output is identical in every language.
using System;
using System.Collections.Generic;
using System.Linq;

class Bloom
{
    readonly bool[] bits;
    public Bloom(int entries) { bits = new bool[entries * 10]; } // 10 bits per key, 4 hashes
    public static uint Fnv(string key, uint seed) // deterministic 32-bit FNV-1a hash, seeded
    {
        uint h = 2166136261u ^ seed;
        foreach (var ch in key) h = unchecked((h ^ ch) * 16777619u);
        return h;
    }
    IEnumerable<int> Slots(string key) { for (uint seed = 1; seed <= 4; seed++) yield return (int)(Fnv(key, seed) % (uint)bits.Length); }
    public void Add(string key) { foreach (var s in Slots(key)) bits[s] = true; }
    public bool MightContain(string key) => Slots(key).All(s => bits[s]);
}

class Run // an immutable sorted file (SSTable): sorted keys, a bloom filter, binary search as the "index"
{
    public readonly List<(string Key, string? Value)> Entries; // null value is a tombstone
    public readonly Bloom Bloom;
    public Run(List<(string, string?)> entries)
    {
        Entries = entries; Bloom = new Bloom(entries.Count);
        foreach (var (k, _) in entries) Bloom.Add(k);
    }
    public (string Key, string? Value)? Find(string key)
    {
        int lo = 0, hi = Entries.Count - 1;
        while (lo <= hi)
        {
            int mid = (lo + hi) >> 1; int c = string.CompareOrdinal(Entries[mid].Key, key);
            if (c == 0) return Entries[mid];
            if (c < 0) lo = mid + 1; else hi = mid - 1;
        }
        return null;
    }
}

class Lsm
{
    readonly int memLimit, maxRuns;
    public Dictionary<string, string?> Mem = new();
    public List<Run> Runs = new(); // Runs[0] is the newest
    public int Puts, Flushed, Compacted, BloomSkips, RunReads;
    public Lsm(int memLimit, int maxRuns) { this.memLimit = memLimit; this.maxRuns = maxRuns; }
    static List<(string, string?)> Sorted(IEnumerable<KeyValuePair<string, string?>> e) =>
        e.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => (p.Key, p.Value)).ToList();
    public void Put(string key, string? value)
    {
        Puts++; // a real engine appends to the write-ahead log here before touching the memtable
        Mem[key] = value;
        if (Mem.Count >= memLimit) Flush();
    }
    public void Delete(string key) => Put(key, null); // a delete is a write of a tombstone
    void Flush()
    {
        var entries = Sorted(Mem);
        Runs.Insert(0, new Run(entries)); Flushed += entries.Count; Mem = new();
        if (Runs.Count > maxRuns) Compact();
    }
    Dictionary<string, string?> Merged()
    {
        var merged = new Dictionary<string, string?>();
        for (int i = Runs.Count - 1; i >= 0; i--) foreach (var (k, v) in Runs[i].Entries) merged[k] = v;
        return merged;
    }
    void Compact() // merge every run into one; newer entries win, and tombstones can finally be dropped
    {
        var entries = Sorted(Merged().Where(p => p.Value != null));
        Compacted += entries.Count;
        Runs = entries.Count > 0 ? new List<Run> { new Run(entries) } : new List<Run>();
    }
    public string? Get(string key)
    {
        if (Mem.TryGetValue(key, out var m)) return m;
        foreach (var run in Runs) // newest to oldest
        {
            if (!run.Bloom.MightContain(key)) { BloomSkips++; continue; }
            RunReads++;
            var hit = run.Find(key);
            if (hit != null) return hit.Value.Value; // a tombstone hides every older value
        }
        return null;
    }
    public List<string> Range(string lo, string hi) // keys in [lo, hi): a scan must merge the memtable and every run
    {
        var merged = Merged();
        foreach (var p in Mem) merged[p.Key] = p.Value;
        return Sorted(merged).Where(e => e.Item2 != null && string.CompareOrdinal(e.Item1, lo) >= 0 && string.CompareOrdinal(e.Item1, hi) < 0)
            .Select(e => $"{e.Item1}={e.Item2}").ToList();
    }
}

static class Program
{
    static uint seed = 7;
    static int Rnd(int n) { seed = unchecked(seed * 1664525u + 1013904223u); return (int)((seed >> 8) % (uint)n); }
    static string UserKey(int n) => $"user:{n:00}";

    static void Fail(string message) { Console.Error.WriteLine(message); Environment.Exit(1); }

    static void Main()
    {
        var db = new Lsm(4, 3);
        var truth = new Dictionary<string, string>(); // a plain map that must always agree with the LSM
        for (int op = 1; op <= 40; op++)
        {
            var key = UserKey(Rnd(16));
            if (Rnd(5) == 0) { db.Delete(key); truth.Remove(key); }
            else { db.Put(key, $"v{op}"); truth[key] = $"v{op}"; }
            for (int n = 0; n < 16; n++)
            {
                truth.TryGetValue(UserKey(n), out var want);
                if (db.Get(UserKey(n)) != want) Fail($"stale read of {UserKey(n)} after op {op}");
            }
            if (op % 10 == 0) Console.WriteLine($"op {op}: runs=[{string.Join(",", db.Runs.Select(r => r.Entries.Count))}] memtable={db.Mem.Count}");
        }
        db.BloomSkips = 0; db.RunReads = 0;
        for (int n = 20; n < 36; n++) if (db.Get(UserKey(n)) != null) Fail("ghost key"); // 16 absent keys
        Console.WriteLine($"16 lookups of absent keys: {db.RunReads} run reads, {db.BloomSkips} skipped by bloom filters");

        int amp = (db.Flushed + db.Compacted) * 100 / db.Puts;
        Console.WriteLine($"writes={db.Puts} flushed={db.Flushed} compacted={db.Compacted} write amplification={amp / 100}.{amp % 100:00}");
        var scan = db.Range("user:04", "user:10");
        Console.WriteLine($"range user:04..user:10 -> {string.Join(" ", scan)}");
        var expected = truth.OrderBy(p => p.Key, StringComparer.Ordinal)
            .Where(p => string.CompareOrdinal(p.Key, "user:04") >= 0 && string.CompareOrdinal(p.Key, "user:10") < 0).Select(p => $"{p.Key}={p.Value}");
        if (!scan.SequenceEqual(expected)) Fail("range disagrees with the reference map");
        Console.WriteLine("all reads saw the newest value");
    }
}
