// A tiny distributed SQL core, in C#: keys split into ranges, versions stamped by a hybrid logical clock,
// and a transaction that commits across ranges with write intents and a transaction record (two-phase commit).
using System;
using System.Collections.Generic;
using System.Linq;

#nullable disable

class Hlc // wall time plus a counter, so timestamps never go backwards and follow causality
{
    public long Offset, Wall, Logical; // Offset: how far this machine's clock is off
    public Hlc(long offset) { Offset = offset; }
    public long Now(long real)
    {
        long w = real + Offset;
        if (w > Wall) { Wall = w; Logical = 0; } else Logical++;
        return Wall * 100 + Logical;
    }
    public void Observe(long ts) { if (ts / 100 > Wall) { Wall = ts / 100; Logical = ts % 100; } } // a message carries a timestamp
}

class Cell { public List<(long Ts, long Value)> Versions = new(); public (int Txn, long Value)? Intent; }

class Range
{
    public string Lo, Hi; public Dictionary<string, Cell> Cells = new();
    public Range(string lo, string hi) { Lo = lo; Hi = hi; }
    public Cell Get(string key) { if (!Cells.TryGetValue(key, out var c)) Cells[key] = c = new Cell(); return c; }
}

class Record { public string Status = "PENDING"; public long Ts; }

class Db
{
    public List<Range> Ranges = new() { new Range("", "~") };
    public Dictionary<int, Record> Records = new();
    public int Seq, MaxKeys;
    public Db(int maxKeys) { MaxKeys = maxKeys; }
    public int RangeIndex(string key) => Ranges.FindIndex(r => string.CompareOrdinal(key, r.Lo) >= 0 && string.CompareOrdinal(key, r.Hi) < 0);
    public Cell CellOf(string key) => Ranges[RangeIndex(key)].Get(key);

    public void Split() // a range with too many keys is cut at its middle key
    {
        for (int i = 0; i < Ranges.Count;)
        {
            var r = Ranges[i];
            var keys = r.Cells.Keys.OrderBy(k => k, StringComparer.Ordinal).ToList();
            if (keys.Count <= MaxKeys) { i++; continue; }
            var mid = keys[keys.Count >> 1];
            var right = new Range(mid, r.Hi);
            foreach (var k in keys) if (string.CompareOrdinal(k, mid) >= 0) { right.Cells[k] = r.Cells[k]; r.Cells.Remove(k); }
            r.Hi = mid; Ranges.Insert(i + 1, right);
        }
    }

    // Reads a key as of ts. A value stamped inside (ts, ts + maxOffset] might have committed before this read began, so the read restarts above it.
    public (bool Blocked, long? Value, int Restarts) Read(string key, long ts, long maxOffset)
    {
        for (int restarts = 0; ; restarts++)
        {
            var c = CellOf(key);
            Record rec = c.Intent.HasValue ? Records[c.Intent.Value.Txn] : null;
            if (rec != null && rec.Status == "PENDING") return (true, null, 0);
            var all = c.Versions.ToList();
            if (rec != null) all.Add((rec.Ts, c.Intent.Value.Value)); // a committed intent counts as a version
            var seen = all.Where(v => v.Ts <= ts).ToList();
            var later = all.Where(v => v.Ts > ts && v.Ts <= ts + maxOffset * 100).ToList();
            if (later.Count == 0) return (false, seen.Count > 0 ? seen[^1].Value : null, restarts);
            ts = later[^1].Ts; maxOffset = 0; // restart at the newest uncertain version
        }
    }
}

class Txn
{
    public Db D; public int Id; public long Ts; public List<string> Keys = new();
    public Txn(Db db, Hlc clock, long real) { D = db; Id = ++db.Seq; Ts = clock.Now(real); db.Records[Id] = new Record { Ts = Ts }; }

    public bool Write(string key, long value) // phase 1: leave an intent on the key. Another transaction's intent blocks us
    {
        var c = D.CellOf(key);
        if (c.Intent.HasValue) return false;
        if (c.Versions.Count > 0 && c.Versions[^1].Ts >= Ts) Ts = c.Versions[^1].Ts + 1; // never write under a newer version
        c.Intent = (Id, value); Keys.Add(key); return true;
    }
    public void Commit() { var rec = D.Records[Id]; rec.Status = "COMMITTED"; rec.Ts = Ts; } // the single atomic commit point
    public void Resolve() // phase 2, in the background: turn the intents into ordinary versions
    {
        foreach (var k in Keys) { var c = D.CellOf(k); c.Versions.Add((Ts, c.Intent.Value.Value)); c.Intent = null; }
    }
}

class Program
{
    static string Js(bool b) => b ? "true" : "false";
    static int Main()
    {
        var db = new Db(3); var a = new Hlc(0); var b = new Hlc(-8);
        var seed = new (string, long)[] { ("alice", 100), ("bob", 50), ("carol", 70), ("maria", 100), ("nina", 20), ("zed", 100) };
        for (int i = 0; i < seed.Length; i++) { var t = new Txn(db, a, 1 + i); t.Write(seed[i].Item1, seed[i].Item2); t.Commit(); t.Resolve(); db.Split(); }
        Console.WriteLine("ranges after splits: " + string.Join(" ", db.Ranges.Select(r => $"[{r.Lo}..{r.Hi})")));
        long Total() => seed.Sum(s => db.Read(s.Item1, 999999, 0).Value.Value);
        long before = Total(), setupTs = 6 * 100;

        var t1 = new Txn(db, a, 20); // move 30 from alice to zed: two keys in two ranges
        t1.Write("alice", 70); t1.Write("zed", 130);
        int ranges = t1.Keys.Select(db.RangeIndex).Distinct().Count();
        Console.WriteLine($"T1 touched {ranges} ranges, commit timestamp {t1.Ts}");
        var t2 = new Txn(db, a, 21);
        Console.WriteLine($"T2 write to zed blocked by T1's intent: {Js(!t2.Write("zed", 1))}");
        Console.WriteLine($"reader before T1 commits is blocked: {Js(db.Read("zed", 3000, 0).Blocked)}");
        t1.Commit();
        Console.WriteLine($"reader after the commit point sees zed = {db.Read("zed", 3000, 0).Value}, even before intents are resolved");
        t1.Resolve();
        Console.WriteLine($"snapshot at ts {setupTs} still sees alice = {db.Read("alice", setupTs, 0).Value}, zed = {db.Read("zed", setupTs, 0).Value}");

        long ts = b.Now(22); // this gateway's clock runs 8 behind, so its read timestamp is below T1's commit timestamp
        var trusting = db.Read("zed", ts, 0); var careful = db.Read("zed", ts, 10);
        Console.WriteLine($"behind clock, read at {ts}: trusting clocks sees {trusting.Value}; with a 10 uncertainty window sees {careful.Value} after {careful.Restarts} restart");
        b.Observe(t1.Ts);
        Console.WriteLine($"after a message from T1's gateway, the next timestamp here is {b.Now(23)}");
        long after = Total();
        Console.WriteLine($"total money before {before}, after {after}");
        bool ok = before == after && ranges == 2 && trusting.Value == 100 && careful.Value == 130 && careful.Restarts == 1 && b.Now(24) > t1.Ts && db.Ranges.Count == 3;
        return ok ? 0 : 1;
    }
}
