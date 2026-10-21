// A tiny lakehouse table in C#: immutable data files, a snapshot per commit,
// optimistic commits that rebase or abort, compaction, time travel and vacuum.
using System;
using System.Collections.Generic;
using System.Linq;

public class Tx
{
    public int Base;
    public List<(string Name, int Rows)> Add = new();
    public List<string> Remove = new();
    public int Rows;
}

public class Table
{
    public List<List<(string Name, int Rows)>> Snaps = new() { new() }; // a snapshot is a list of files
    public Dictionary<string, int> Store = new();
    int seq = 0;
    int oldest = 0;
    public int Head => Snaps.Count - 1;

    public (string Name, int Rows) NewFile(int rows) { var name = $"f{++seq}"; Store[name] = rows; return (name, rows); } // uploaded before it is committed
    public Tx Begin() => new Tx { Base = Head };

    // Commit succeeds only if nobody committed since tx.Base. Otherwise rebase on the new head,
    // unless a file this transaction wants to remove is already gone: that is a real conflict.
    public (bool Ok, int Rebases) Commit(Tx tx)
    {
        int rebases = 0;
        while (true)
        {
            if (tx.Base == Head)
            {
                var kept = Snaps[Head].Where(f => !tx.Remove.Contains(f.Name));
                Snaps.Add(kept.Concat(tx.Add).ToList());
                return (true, rebases);
            }
            var now = Snaps[Head];
            if (tx.Remove.Any(n => !now.Any(f => f.Name == n))) return (false, rebases);
            tx.Base = Head; rebases++;
        }
    }

    public int Total(int v)
    {
        if (v < oldest) throw new InvalidOperationException($"snapshot {v} expired");
        return Snaps[v].Sum(f => f.Rows);
    }

    public void Vacuum(int keep) // forget old snapshots, then delete files that no kept snapshot uses
    {
        oldest = Head - keep + 1;
        var live = Snaps.Skip(oldest).SelectMany(s => s).Select(f => f.Name).ToHashSet();
        foreach (var n in Store.Keys.ToList()) if (!live.Contains(n)) Store.Remove(n);
    }
}

public static class Program
{
    const int Seed = 7, Rounds = 12, Writers = 3, MinRows = 10, RowSpread = 40;
    const int SmallFileRows = 30; // compaction merges files smaller than this
    const int AppendRows = 25, DeletedRows = 5, KeepSnapshots = 3, OldVersion = 3;
    static uint seed = Seed;
    // Linear congruential generator (Numerical Recipes constants), top 24 bits.
    static int Rnd(int n) { seed = unchecked(seed * 1664525u + 1013904223u); return (int)((seed >> 8) % (uint)n); }

    static Table t = new();
    static List<int> history = new() { 0 }; // history[v] = rows at version v, written down at commit time
    static int expected = 0, rebases = 0;

    static void Done(Tx tx)
    {
        var (ok, r) = t.Commit(tx);
        if (!ok) throw new Exception("unexpected conflict");
        rebases += r; history.Add(t.Total(t.Head));
    }

    static Tx Plan() // merge every small file into one
    {
        var tx = t.Begin(); var small = t.Snaps[tx.Base].Where(f => f.Rows < SmallFileRows).ToList();
        tx.Remove = small.Select(f => f.Name).ToList(); tx.Add.Add(t.NewFile(small.Sum(f => f.Rows)));
        return tx;
    }

    public static int Main()
    {
        for (int round = 0; round < Rounds; round++) // three writers start from the same snapshot every round
        {
            var txs = new List<Tx>();
            for (int w = 0; w < Writers; w++) { var tx = t.Begin(); tx.Rows = MinRows + Rnd(RowSpread); tx.Add.Add(t.NewFile(tx.Rows)); txs.Add(tx); }
            foreach (var tx in txs) { Done(tx); expected += tx.Rows; }
        }
        Console.WriteLine($"appends: version {t.Head}, {t.Snaps[t.Head].Count} files, {t.Total(t.Head)} rows, {rebases} rebases");

        var compaction = Plan();
        var append = t.Begin(); append.Add.Add(t.NewFile(AppendRows));
        var del = t.Begin(); var victim = compaction.Remove[0]; del.Remove.Add(victim); del.Add.Add(t.NewFile(t.Store[victim] - DeletedRows));
        Done(append); expected += AppendRows;
        Done(del); expected -= DeletedRows;
        int conflicts = 0;
        while (!t.Commit(compaction).Ok) { conflicts++; compaction = Plan(); } // replan from the new head
        history.Add(t.Total(t.Head));
        Console.WriteLine($"compaction: {conflicts} conflict, version {t.Head}, {t.Snaps[t.Head].Count} files, {t.Total(t.Head)} rows");

        int before = t.Store.Count;
        t.Vacuum(KeepSnapshots);
        Console.WriteLine($"vacuum: {before} stored files -> {t.Store.Count}");
        bool expired = false;
        try { t.Total(OldVersion); } catch (InvalidOperationException) { expired = true; }
        bool travel = new[] { t.Head - 2, t.Head - 1, t.Head }.All(v => t.Total(v) == history[v]);
        Console.WriteLine($"time travel matches history: {travel.ToString().ToLower()}; version 3 expired: {expired.ToString().ToLower()}");
        return t.Total(t.Head) != expected || !travel || !expired || conflicts != 1 ? 1 : 0;
    }
}
