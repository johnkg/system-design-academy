// Point-in-time recovery in C#: a base backup plus an ordered change log (the WAL archive).
// Restore() copies the base, then replays records in LSN order until the target time or LSN.
using System;
using System.Collections.Generic;
using System.Linq;

public record Rec(int Lsn, int Ts, string Op, int Id, int Total);
public record Base(int Ts, int Lsn, SortedDictionary<int, int> Orders);

public class Primary
{
    public SortedDictionary<int, int> Orders = new();
    public List<Rec> Log = new(); // ordered change log

    public int Do(int ts, string op, int id = 0, int total = 0)
    {
        var rec = new Rec(Log.Count + 1, ts, op, id, total);
        Log.Add(rec); // log first, then change the table
        Program.Apply(Orders, rec);
        return rec.Lsn;
    }
    public Base BaseBackup(int ts) => new(ts, Log.Count, new SortedDictionary<int, int>(Orders));
}

public static class Program
{
    const int SecondsPerMinute = 60, SecondsPerHour = 3600;
    const int MissingLsn = 6; // the archive segment we drop to show a broken chain
    static string Clock(int t) => $"{t / SecondsPerHour:00}:{t % SecondsPerHour / SecondsPerMinute:00}:{t % SecondsPerMinute:00}";
    static int At(int h, int m, int s = 0) => h * SecondsPerHour + m * SecondsPerMinute + s;
    static readonly int MistakeAt = At(14, 3); // when the DELETE without WHERE runs

    public static void Apply(SortedDictionary<int, int> orders, Rec rec)
    {
        if (rec.Op == "delete_all") orders.Clear();
        else orders[rec.Id] = rec.Total; // insert and update both set the row
    }

    static (SortedDictionary<int, int>, int) Restore(Base b, List<Rec> archive, int? targetTs = null, int? targetLsn = null)
    {
        var orders = new SortedDictionary<int, int>(b.Orders);
        int expected = b.Lsn + 1, last = b.Lsn;
        foreach (var rec in archive)
        {
            if (rec.Lsn <= b.Lsn) continue; // already contained in the base backup
            if (rec.Lsn != expected) throw new InvalidOperationException($"archive gap: expected LSN {expected}, found {rec.Lsn}");
            if (targetTs != null && rec.Ts > targetTs) break;
            if (targetLsn != null && rec.Lsn > targetLsn) break;
            Apply(orders, rec);
            last = rec.Lsn;
            expected++;
        }
        return (orders, last);
    }

    static string Show(SortedDictionary<int, int> o) => o.Count == 0 ? "(empty)" : string.Join(" ", o.Select(kv => $"{kv.Key}={kv.Value}"));

    static void Check(bool cond, string msg)
    {
        if (!cond) { Console.Error.WriteLine("FAILED: " + msg); Environment.Exit(1); }
    }

    public static void Main()
    {
        var db = new Primary();
        foreach (var (id, total) in new[] { (1, 20), (2, 40), (3, 15) }) db.Do(At(1, 0), "insert", id, total);
        var b = db.BaseBackup(At(2, 0)); // 02:00 base backup
        db.Do(At(2, 10), "insert", 4, 30);
        db.Do(At(9, 30), "insert", 5, 40);
        db.Do(At(11, 45), "update", 2, 55);
        db.Do(At(13, 59, 58), "insert", 6, 25);
        int bad = db.Do(At(14, 3), "delete_all"); // the mistake
        db.Do(At(14, 3, 30), "insert", 7, 35);
        var archive = db.Log;
        Console.WriteLine($"base backup {Clock(b.Ts)} covers up to LSN {b.Lsn}; archive holds LSN {b.Lsn + 1}..{archive.Count}");
        Console.WriteLine($"DELETE without WHERE is LSN {bad} at {Clock(archive[bad - 1].Ts)}");

        var (good, n) = Restore(b, archive, MistakeAt - 1);
        Console.WriteLine($"restore to {Clock(MistakeAt - 1)}: applied through LSN {n}: {Show(good)}");
        var (byLsn, n2) = Restore(b, archive, null, bad - 1);
        Console.WriteLine($"restore to LSN {bad - 1}: {Show(byLsn)}");
        bool same = Show(byLsn) == Show(good);
        Console.WriteLine($"same result by time and by LSN: {same.ToString().ToLower()}");
        var (after, _) = Restore(b, archive, MistakeAt);
        Console.WriteLine($"restore to {Clock(MistakeAt)}: {Show(after)}");
        var (latest, _2) = Restore(b, archive);
        Console.WriteLine($"restore to end of log: {Show(latest)}");
        Console.WriteLine($"replica (replays everything): {Show(db.Orders)}");
        Console.WriteLine($"base backup only (no archive): {Show(b.Orders)}");
        try { Restore(b, archive.Where(r => r.Lsn != MissingLsn).ToList()); }
        catch (InvalidOperationException e) { Console.WriteLine($"broken archive: {e.Message}"); }

        Check(Show(good) == "1=20 2=55 3=15 4=30 5=40 6=25" && n == bad - 1, "restore before the delete");
        Check(same && n2 == bad - 1, "time and LSN targets agree");
        Check(Show(after) == "(empty)" && Show(latest) == "7=35" && Show(db.Orders) == Show(latest), "later targets reproduce the delete");
        Check(Show(b.Orders) == "1=20 2=40 3=15", "base backup is a snapshot");
    }
}
