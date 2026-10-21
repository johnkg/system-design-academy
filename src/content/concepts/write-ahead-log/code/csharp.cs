// A mini database with a write-ahead log: log first, lazy page writes, crash, then analysis / redo / undo.
// Records are Rec(Lsn, Kind, Tx, Page, Delta, Ref). For a ckpt_end record Ref is the LSN where its checkpoint began;
// for a clr (compensation) record Ref is the LSN of the update it undoes.
using System;
using System.Collections.Generic;
using System.Linq;

record Rec(int Lsn, string Kind, int Tx, int Page, int Delta, int Ref);

class Db
{
    public Dictionary<int, int[]> Disk = new();   // page -> [balance, pageLSN]
    public Dictionary<int, int[]> Pool = new();   // buffer pool: cached, possibly dirty pages
    public List<Rec> Log = new();                 // the log, including a not yet durable tail
    public int Flushed = 0;                       // Log[..Flushed] has been fsynced
    public int Fsyncs = 0;

    public Db(int[] balances) { for (int p = 0; p < balances.Length; p++) Disk[p] = new[] { balances[p], 0 }; }

    int Append(string kind, int tx, int page = -1, int delta = 0, int rf = 0)
    {
        int lsn = Log.Count + 1;
        Log.Add(new Rec(lsn, kind, tx, page, delta, rf));
        return lsn;
    }
    void Flush() { if (Log.Count > Flushed) { Flushed = Log.Count; Fsyncs++; } }

    public void Update(int tx, int page, int delta)
    {
        int lsn = Append("update", tx, page, delta);                       // 1. describe the change in the log
        if (!Pool.ContainsKey(page)) Pool[page] = (int[])Disk[page].Clone();
        Pool[page][0] += delta;                                            // 2. then change the cached page
        Pool[page][1] = lsn;                                               // pageLSN = LSN of the last change
    }
    public void Commit(int tx) { Append("commit", tx); Flush(); }          // committed = commit record is durable
    public void Evict(int page, bool obeyWal)                              // steal: write a page that may be uncommitted
    {
        if (obeyWal) Flush();                                              // write-ahead rule: log reaches disk first
        Disk[page] = Pool[page];
        Pool.Remove(page);
    }
    public void Checkpoint()
    {
        int begin = Append("ckpt_begin", 0);
        Flush();
        foreach (int page in Pool.Keys.OrderBy(k => k).ToList()) Evict(page, true);
        Append("ckpt_end", 0, -1, 0, begin);
        Flush();
    }
    public (Dictionary<int, int[]>, List<Rec>) Crash()                     // power loss: pool and log tail vanish
        => (Disk.ToDictionary(kv => kv.Key, kv => (int[])kv.Value.Clone()), Log.Take(Flushed).ToList());
}

static class Program
{
    static (int, int, int, List<int>, int) Recover(Dictionary<int, int[]> disk, List<Rec> durable)
    {
        var log = new List<Rec>(durable);
        int start = 1;
        var state = new Dictionary<int, string>();
        foreach (var r in log) if (r.Kind == "ckpt_end") start = r.Ref;     // newest complete checkpoint
        var scanned = log.Where(r => r.Lsn >= start).ToList();
        foreach (var r in scanned)                                          // analysis: who was still running?
        {
            if (r.Kind == "update" || r.Kind == "clr") { if (!state.ContainsKey(r.Tx)) state[r.Tx] = "active"; }
            else if (r.Kind == "commit") state[r.Tx] = "committed";
        }
        var losers = state.Where(kv => kv.Value == "active").Select(kv => kv.Key).OrderBy(t => t).ToList();
        int redone = 0, skipped = 0;
        foreach (var r in scanned)                                          // redo: repeat history from the checkpoint
        {
            if (r.Kind != "update" && r.Kind != "clr") continue;
            var pg = disk[r.Page];
            if (pg[1] < r.Lsn) { pg[0] += r.Delta; pg[1] = r.Lsn; redone++; } // page older than the record? apply it
            else skipped++;
        }
        var done = log.Where(r => r.Kind == "clr").Select(r => r.Ref).ToHashSet();
        int undone = 0;
        foreach (var r in Enumerable.Reverse(log.ToList()))                 // undo losers, newest change first
        {
            if (r.Kind == "update" && losers.Contains(r.Tx) && !done.Contains(r.Lsn))
            {
                int lsn = log[^1].Lsn + 1;
                log.Add(new Rec(lsn, "clr", r.Tx, r.Page, -r.Delta, r.Lsn)); // the undo is logged
                disk[r.Page][0] -= r.Delta; disk[r.Page][1] = lsn;
                undone++;
            }
        }
        return (scanned.Count, redone, skipped, losers, undone);
    }

    static readonly int[] StartBalances = { 100, 100, 100, 100 }; // four pages of $100

    static int[] Scenario(bool obeyWal)
    {
        var db = new Db(StartBalances);
        db.Update(1, 0, -30); db.Update(1, 1, 30); db.Commit(1);            // T1: page 0 -> page 1, $30
        db.Checkpoint();
        db.Update(2, 2, -20); db.Update(2, 3, 20); db.Commit(2);            // T2 commits, its pages stay in the pool
        db.Update(3, 0, -10); db.Update(3, 2, 10); db.Commit(3);            // T3 commits too
        db.Update(4, 1, -50);                                               // T4 debits page 1 ...
        db.Evict(1, obeyWal);                                               // ... the pool steals that dirty page ...
        var (disk, log) = db.Crash();                                       // ... and the power fails before T4 commits
        string onDisk = string.Join(",", Enumerable.Range(0, StartBalances.Length).Select(p => disk[p][0]));
        var (scanned, redone, skipped, losers, undone) = Recover(disk, log);
        int[] final = Enumerable.Range(0, StartBalances.Length).Select(p => disk[p][0]).ToArray();
        Console.WriteLine($"obey write-ahead rule: {(obeyWal ? "true" : "false")}");
        Console.WriteLine($"  durable log {log.Count} records, fsyncs {db.Fsyncs}, pages on disk at crash [{onDisk}]");
        Console.WriteLine($"  analysis scanned {scanned}, losers [{string.Join(",", losers)}]; redo applied {redone} skipped {skipped}; undo {undone}");
        Console.WriteLine($"  recovered [{string.Join(",", final)}] total {final.Sum()}");
        return final;
    }

    static int Main()
    {
        var good = Scenario(true);
        if (!good.SequenceEqual(new[] { 60, 130, 90, 120 })) throw new Exception("T1+T2+T3 must survive and T4 must be gone");
        var bad = Scenario(false);
        if (!bad.SequenceEqual(new[] { 60, 80, 90, 120 })) throw new Exception("without the rule T4's debit leaks");
        Console.WriteLine("committed data survived; uncommitted data vanished only with the write-ahead rule");
        return 0;
    }
}
