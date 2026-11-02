// A miniature of Percolator's transactions from Google's OSDI 2010 paper, in C# (a teaching model, not Google's code):
// every cell has data, lock and write columns indexed by timestamp, a timestamp oracle hands out increasing numbers, a
// transaction reads at its start timestamp, commits with two-phase commit in which one cell's write record is the commit point,
// and a reader that meets a lock left by a crashed transaction rolls it back or forward by looking at the primary lock.
// The example is the paper's: moving $7 from Bob ($10) to Joe ($2). Everything is deterministic.

using System;
using System.Collections.Generic;
using System.Linq;

int oracle = 0;
int NextTs() => ++oracle;
var rows = new Dictionary<string, Cell>();
var rowOrder = new List<string>();
Cell GetCell(string row)
{
    if (!rows.TryGetValue(row, out var c)) { c = new Cell(); rows[row] = c; rowOrder.Add(row); }
    return c;
}

void Seed(string row, int value) { int s = NextTs(), c = NextTs(); GetCell(row).Data[s] = value; GetCell(row).Write[c] = s; }
string Fmt<T>(SortedDictionary<int, T> d) => "{" + string.Join(" ", d.Select(p => $"{p.Key}:{p.Value}")) + "}";
void Show(string label)
{
    Console.WriteLine(label);
    foreach (var r in rowOrder) Console.WriteLine($"  {r}: data {Fmt(rows[r].Data)}  lock {Fmt(rows[r].Lock)}  write {Fmt(rows[r].Write)}");
}

(int Commit, int DataTs)? LatestWrite(string row, int ts) // newest commit timestamp at or below ts, and the data timestamp it points to
{
    var keys = GetCell(row).Write.Keys.Where(k => k <= ts).OrderByDescending(k => k).ToList();
    return keys.Count == 0 ? null : (keys[0], GetCell(row).Write[keys[0]]);
}

(int? Blocked, int? Value) Get(string row, int ts)
{
    var locked = GetCell(row).Lock.Keys.Where(k => k <= ts).ToList();
    if (locked.Count > 0) return (locked.Min(), null); // a lock at or below our timestamp: the writer may still commit below it
    var w = LatestWrite(row, ts);
    return (null, w == null ? null : GetCell(row).Data[w.Value.DataTs]);
}

string Prewrite(string row, int value, int startTs, string primary)
{
    var c = GetCell(row);
    if (c.Write.Keys.Any(k => k >= startTs)) return "conflict: a later commit exists";
    if (c.Lock.Count > 0) return "conflict: the cell is locked";
    c.Data[startTs] = value;
    c.Lock[startTs] = row == primary ? "primary" : $"secondary of {primary}";
    return "ok";
}

void CommitCell(string row, int startTs, int commitTs) { var c = GetCell(row); c.Write[commitTs] = startTs; c.Lock.Remove(startTs); }

(int Start, string Outcome) Transfer(string src, string dst, int amount, string? crashAfter = null) // "crashAfter" stops the transaction at a chosen point
{
    int startTs = NextTs();
    int a = Get(src, startTs).Value!.Value, b = Get(dst, startTs).Value!.Value;
    var results = new[] { Prewrite(src, a - amount, startTs, src), Prewrite(dst, b + amount, startTs, src) };
    var bad = results.Where(r => r != "ok").ToList();
    if (bad.Count > 0)
    {
        foreach (var r in new[] { src, dst }) { GetCell(r).Lock.Remove(startTs); GetCell(r).Data.Remove(startTs); }
        return (startTs, $"aborted ({bad[0]})");
    }
    if (crashAfter == "prewrite") return (startTs, "crashed after the prewrite, locks left behind");
    int commitTs = NextTs();
    CommitCell(src, startTs, commitTs); // the primary's write record is the commit point
    if (crashAfter == "primary") return (startTs, "crashed after committing the primary, the secondary lock is left");
    CommitCell(dst, startTs, commitTs);
    return (startTs, $"committed at {commitTs}");
}

// A reader that meets a lock decides what to do from the primary cell. (Real Percolator does this only when the lock's owner is
// judged dead, after a wait; here the owner has crashed.)
string Resolve(string row)
{
    int lockTs = GetCell(row).Lock.Keys.First();
    string kind = GetCell(row).Lock[lockTs];
    string primary = kind == "primary" ? row : kind.Replace("secondary of ", "");
    if (GetCell(primary).Lock.ContainsKey(lockTs)) // the primary is still locked: the transaction never committed
    {
        GetCell(primary).Lock.Remove(lockTs); GetCell(primary).Data.Remove(lockTs);
        if (row != primary) { GetCell(row).Lock.Remove(lockTs); GetCell(row).Data.Remove(lockTs); }
        return $"rolled back the transaction that started at {lockTs}";
    }
    int commit = GetCell(primary).Write.First(p => p.Value == lockTs).Key;
    CommitCell(row, lockTs, commit); // the primary committed: finish the secondary
    return $"rolled forward the transaction that started at {lockTs}, committed at {commit}";
}

int? Read(string row, int ts)
{
    var r = Get(row, ts);
    if (r.Blocked != null)
    {
        Console.WriteLine($"  reading {row} at {ts} meets a lock from {r.Blocked}: {Resolve(row)}");
        r = Get(row, ts);
    }
    return r.Value;
}

Seed("Bob", 10); Seed("Joe", 2);
Show("--- before: Bob has 10 and Joe has 2");
var t = Transfer("Bob", "Joe", 7);
Console.WriteLine($"transfer of 7: {t.Outcome}");
Show("--- after the commit");
int? oldBob = Read("Bob", t.Start), oldJoe = Read("Joe", t.Start);
int tsNew = NextTs();
Console.WriteLine($"a reader with timestamp {t.Start} sees Bob {oldBob}, Joe {oldJoe}; one with timestamp {tsNew} sees Bob {Read("Bob", tsNew)}, Joe {Read("Joe", tsNew)}");

Console.WriteLine("--- two transfers that overlap");
int first = NextTs(); // both read before either commits
string x = Prewrite("Bob", 0, first, "Bob");
string y = Prewrite("Bob", 0, first + 1, "Bob");
Console.WriteLine($"first prewrite of Bob: {x}; second prewrite of Bob: {y}");
GetCell("Bob").Lock.Remove(first);
foreach (var k in new[] { first, first + 1 }) GetCell("Bob").Data.Remove(k);

Console.WriteLine("--- a transaction crashes after the prewrite");
t = Transfer("Bob", "Joe", 1, "prewrite");
Console.WriteLine($"transfer of 1: {t.Outcome}");
int ts1 = NextTs();
Console.WriteLine($"  a reader gets: Joe {Read("Joe", ts1)}");

Console.WriteLine("--- a transaction crashes after committing the primary");
t = Transfer("Bob", "Joe", 1, "primary");
Console.WriteLine($"transfer of 1: {t.Outcome}");
int ts2 = NextTs();
Console.WriteLine($"  a reader gets: Joe {Read("Joe", ts2)}");
Show("--- final state");

class Cell
{
    public SortedDictionary<int, int> Data { get; } = new();
    public SortedDictionary<int, string> Lock { get; } = new();
    public SortedDictionary<int, int> Write { get; } = new();
}
