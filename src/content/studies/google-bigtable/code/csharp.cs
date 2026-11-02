// A miniature of one Bigtable tablet from the Bigtable paper (OSDI 2006), in C# (a teaching model, not Google's code):
// every write goes to a commit log and then to an in-memory sorted buffer (the memtable). A full memtable becomes an immutable
// SSTable (a minor compaction). Reads merge the memtable and the SSTables, newest first, and a Bloom filter lets a read skip
// SSTables that cannot hold a row. A crash loses the memtable, which is rebuilt from the log. A major compaction rewrites
// everything into one SSTable and drops deletions. Everything is deterministic.

using System;
using System.Collections.Generic;
using System.Linq;

const int MemtableLimit = 3; // entries in the memtable before it is written out
const int BloomBits = 16;

var log = new List<Entry>();
int redo = 0, clock = 0;
var memtable = new Dictionary<string, Entry>();
var sstables = new List<SsTable>(); // newest first

int[] BitsFor(string row) // two cheap hash functions over the row key
{
    int sum = row.Sum(ch => (int)ch);
    return new[] { sum % BloomBits, (sum * 7 + 3) % BloomBits };
}
bool[] MakeBloom(IEnumerable<Entry> rows)
{
    var bloom = new bool[BloomBits];
    foreach (var e in rows) foreach (var b in BitsFor(e.Row)) bloom[b] = true;
    return bloom;
}

void Write(string row, string? value) // null means a deletion marker
{
    var entry = new Entry(row, value, ++clock);
    log.Add(entry); // 1. commit log (GFS in the paper)
    memtable[row] = entry; // 2. memtable
    if (memtable.Count >= MemtableLimit) MinorCompaction();
}

void MinorCompaction()
{
    var rows = memtable.Values.OrderBy(e => e.Row, StringComparer.Ordinal).ToList(); // SSTables are sorted by row key
    sstables.Insert(0, new SsTable(rows, MakeBloom(rows)));
    memtable = new Dictionary<string, Entry>();
    redo = log.Count; // the log before this point is no longer needed for recovery
    Console.WriteLine($"minor compaction: memtable became SSTable #{sstables.Count} with {rows.Count} entries");
}

void Report(string row, Entry? entry, int touched, int skipped)
{
    string shown = entry is null ? "not found" : entry.Value is null ? "deleted" : entry.Value;
    Console.WriteLine($"read {row}: {shown} (read {touched} SSTable{(touched == 1 ? "" : "s")}, Bloom filter skipped {skipped})");
}

void Read(string row)
{
    if (memtable.TryGetValue(row, out var inMemory)) { Report(row, inMemory, 0, 0); return; }
    int touched = 0, skipped = 0;
    foreach (var table in sstables)
    {
        if (!BitsFor(row).All(b => table.Bloom[b])) { skipped++; continue; } // the filter says the row is not here
        touched++;
        var hit = table.Rows.FirstOrDefault(e => e.Row == row);
        if (hit is not null) { Report(row, hit, touched, skipped); return; }
    }
    Report(row, null, touched, skipped);
}

void CrashAndRecover()
{
    int lost = memtable.Count;
    memtable = new Dictionary<string, Entry>(); // the memtable lived only in memory
    foreach (var e in log.Skip(redo)) memtable[e.Row] = e; // replay the log from the redo point
    Console.WriteLine($"crash: lost {lost} memtable entries, replayed {log.Count - redo} from the log, memtable has {memtable.Count}");
}

void MajorCompaction()
{
    int before = sstables.Sum(t => t.Rows.Count), tables = sstables.Count;
    var newest = new Dictionary<string, Entry>();
    foreach (var table in Enumerable.Reverse(sstables))
        foreach (var e in table.Rows) newest[e.Row] = e; // newer entries replace older
    var rows = newest.Values.Where(e => e.Value is not null).OrderBy(e => e.Row, StringComparer.Ordinal).ToList();
    sstables = new List<SsTable> { new SsTable(rows, MakeBloom(rows)) };
    Console.WriteLine($"major compaction: {before} entries in {tables} SSTables became {rows.Count} entries in 1 SSTable, deletions gone");
}

// Row keys are reversed host names, so pages of one site sort next to each other.
Write("com.cnn.www/index.html", "<html>cnn v1");
Write("com.cnn.www/world", "<html>world v1");
Write("com.google.maps/index.html", "<html>maps v1");
Write("com.cnn.www/index.html", "<html>cnn v2");
Write("com.cnn.www/world", null);
Write("org.apache.www/index.html", "<html>apache v1");
Read("com.cnn.www/index.html");
Read("com.cnn.www/world");
Read("org.apache.www/index.html");
Read("org.example.www/index.html");
Write("org.wikipedia.www/index.html", "<html>wiki v1");
CrashAndRecover();
Read("org.wikipedia.www/index.html");
MajorCompaction();
Read("com.cnn.www/world");

record Entry(string Row, string? Value, int Ts);
record SsTable(List<Entry> Rows, bool[] Bloom);
