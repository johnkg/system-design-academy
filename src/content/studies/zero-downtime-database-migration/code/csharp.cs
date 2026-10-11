// A live migration in C#: snapshot, then a change log replayed on the new database, chunk checksums, a cutover, and a way back.
// The "databases" are dictionaries from row id to value, so the idea fits on one screen.
using System;
using System.Collections.Generic;
using System.Linq;

public record Change(string Op, int Id, int Val);

public static class Rng
{
    static long seed = 7;
    public static void Reset() => seed = 7;
    public static int Next(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)((seed / 65536) % n); }
}

public class Db
{
    public Dictionary<int, int> Rows = new();
    public List<Change> Log = new(); // the change stream (a Postgres WAL, a MySQL binlog)
    public int NextId = 1;

    public void Set(int id, int val) { Rows[id] = val; Log.Add(new Change("set", id, val)); }
    public void Del(int id) { Rows.Remove(id); Log.Add(new Change("del", id, 0)); }

    // Idempotent: replaying an entry changes nothing; the id counter follows the highest id seen.
    public void Apply(Change e)
    {
        NextId = Math.Max(NextId, e.Id + 1);
        if (e.Op == "set") Rows[e.Id] = e.Val; else Rows.Remove(e.Id);
    }

    public int Get(int id) => Rows.GetValueOrDefault(id, -1);
}

public static class Program
{
    static void Workload(Db db, int n) // updates, inserts and deletes, as the application keeps running
    {
        for (int i = 0; i < n; i++)
        {
            int r = Rng.Next(10);
            if (r < 6) { int id = 1 + Rng.Next(db.NextId - 1); db.Set(id, Rng.Next(1000)); }
            else if (r < 8) { int id = db.NextId++; db.Set(id, Rng.Next(1000)); }
            else db.Del(1 + Rng.Next(db.NextId - 1));
        }
    }

    static int Diverged(Db a, Db b)
    {
        int n = 0;
        for (int id = 1; id < Math.Max(a.NextId, b.NextId); id++) if (a.Get(id) != b.Get(id)) n++;
        return n;
    }

    static Dictionary<int, uint> ChunkSums(Db db, int size) // one checksum per range of ids, cheap to compare even for billions of rows
    {
        var sums = new Dictionary<int, uint>();
        for (int id = 1; id < db.NextId; id++)
        {
            int c = (id - 1) / size;
            sums.TryAdd(c, 0);
            if (db.Rows.ContainsKey(id)) sums[c] = unchecked(sums[c] * 31 + (uint)(id * 1000 + db.Rows[id]));
        }
        return sums;
    }

    static int BadChunks(Db a, Db b)
    {
        var x = ChunkSums(a, 100); var y = ChunkSums(b, 100);
        return x.Count(p => !y.TryGetValue(p.Key, out var v) || v != p.Value);
    }

    static Db Build()
    {
        Rng.Reset();
        var db = new Db();
        for (int i = 0; i < 1000; i++) db.Set(db.NextId++, Rng.Next(1000));
        db.Log = new();
        return db;
    }

    static (int lost, int off) Migrate(bool reverse)
    {
        var src = Build(); var snap = new Dictionary<int, int>(src.Rows); int snapNext = src.NextId; var dst = new Db();
        for (int t = 0; t < 10; t++)
        {
            for (int id = 1 + t * 100; id < 101 + t * 100; id++) if (snap.ContainsKey(id)) dst.Rows[id] = snap[id];
            Workload(src, 50);
        }
        int applied = 0, ticks = 0, start = src.Log.Count;
        while (src.Log.Count - applied >= 30)
        {
            Workload(src, 50);
            for (int k = 0; k < 80 && applied < src.Log.Count; k++) dst.Apply(src.Log[applied++]);
            ticks++;
        }
        int lag = src.Log.Count - applied, before = BadChunks(src, dst); // freeze writes here
        while (applied < src.Log.Count) dst.Apply(src.Log[applied++]);
        Console.WriteLine($"snapshot + log: {start} entries behind after the bulk copy, caught up in {ticks} ticks, lag at the freeze {lag}");
        Console.WriteLine($"checksums: {before} chunks differ at the freeze, {BadChunks(src, dst)} after the last entries; rows diverged {Diverged(src, dst)}");
        if (Diverged(src, dst) != 0 || BadChunks(src, dst) != 0) Environment.Exit(1);
        int clash = 0; for (int k = 0; k < 50; k++) if (src.Rows.ContainsKey(snapNext + k)) clash++;
        dst.NextId = src.NextId + 1000; // leave a gap, so new ids never meet ids the old database handed out
        Console.WriteLine($"ids: restarting at {snapNext} collides with {clash} live rows; restarting at {dst.NextId} collides with 0");
        if (clash == 0) Environment.Exit(1);
        dst.Log = new(); Workload(dst, 200); // the flip happened; the new database takes 200 writes
        if (reverse) foreach (var e in dst.Log) src.Apply(e); // reverse replication keeps the old database current
        int lost = reverse ? 0 : dst.Log.Count;
        Console.WriteLine($"rollback {(reverse ? "with" : "without")} reverse replication: {lost} writes lost, rows diverged {Diverged(src, dst)}");
        return (lost, Diverged(src, dst));
    }

    public static void Main()
    {
        // 1. Copying rows while the application writes, with no snapshot and no change log.
        var src = Build(); var dst = new Db(); int end = src.NextId;
        for (int t = 0; t < 10; t++)
        {
            for (int id = 1 + t * 100; id < Math.Min(end, 101 + t * 100); id++) if (src.Rows.ContainsKey(id)) dst.Rows[id] = src.Rows[id];
            Workload(src, 50);
        }
        dst.NextId = src.NextId;
        int naive = Diverged(src, dst);
        Console.WriteLine($"live copy with no change log: {naive} rows diverged");
        if (naive == 0) Environment.Exit(1);

        // 2. Snapshot, bulk copy, then replay the change log, 80 entries per tick, until the lag is below 30.
        var a = Migrate(true); var b = Migrate(false);
        if (a.lost != 0 || a.off != 0 || b.lost == 0 || b.off == 0) Environment.Exit(1);
    }
}
