// A miniature of the storage engine in the Bigtable paper, in C# (a teaching model, not Google's code): a write goes to a
// commit log and a memtable, a full memtable is flushed to an immutable sorted file (an SSTable), a read looks at the memtable
// and then the files from newest to oldest, a merging compaction keeps the number of files small, and a Bloom filter lets a read
// skip files that cannot hold the row. Everything is deterministic, so every run prints the same thing. All numbers are made up.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

const int MemtableLimit = 3; // entries that fill a memtable
const int MaxFiles = 2; // a merging compaction runs when there are more files than this
const int BloomBits = 64;

// A tiny Bloom filter: three hashes set three bits. It can say "maybe" wrongly, but never "no" for a row that is there.
static uint Fnv(string text, uint seed)
{
    var h = 0x811C9DC5 ^ seed;
    foreach (var b in Encoding.UTF8.GetBytes(text)) h = unchecked((h ^ b) * 0x01000193);
    return h;
}

static int[] BitsFor(string row) => new uint[] { 1, 2, 3 }.Select(seed => (int)(Fnv(row, seed) % BloomBits)).ToArray();

static HashSet<int> MakeFilter(IEnumerable<string> names)
{
    var bits = new HashSet<int>();
    foreach (var name in names) foreach (var bit in BitsFor(name)) bits.Add(bit);
    return bits;
}

static bool MightHold(HashSet<int> filter, string row) => BitsFor(row).All(bit => filter.Contains(bit));

var log = new List<(string Row, string Value)>(); // the commit log: every mutation, in order
var memtable = new Dictionary<string, string>(); // row -> value, the newest data
var files = new List<(Dictionary<string, string> Rows, HashSet<int> Filter)>(); // SSTables, oldest first
var seeks = 0; // file reads, to show what the filter saves
var compactions = 0;

void Write(string row, string value)
{
    log.Add((row, value)); // the log first, so a crash loses nothing
    memtable[row] = value;
    if (memtable.Count >= MemtableLimit) MinorCompaction();
}

void MinorCompaction()
{
    var sortedRows = memtable.OrderBy(pair => pair.Key, StringComparer.Ordinal).ToDictionary(pair => pair.Key, pair => pair.Value); // an SSTable is sorted and never changes
    files.Add((sortedRows, MakeFilter(sortedRows.Keys)));
    memtable = new Dictionary<string, string>();
    if (files.Count > MaxFiles) MergingCompaction();
}

// A merging compaction reads all the files and writes one: the newest value of each row wins.
void MergingCompaction()
{
    var merged = new Dictionary<string, string>();
    foreach (var file in files) foreach (var pair in file.Rows) merged[pair.Key] = pair.Value;
    var sortedRows = merged.OrderBy(pair => pair.Key, StringComparer.Ordinal).ToDictionary(pair => pair.Key, pair => pair.Value);
    files = new List<(Dictionary<string, string> Rows, HashSet<int> Filter)> { (sortedRows, MakeFilter(sortedRows.Keys)) };
    compactions++;
}

(bool Found, string Value) Read(string row, bool useFilters)
{
    if (memtable.TryGetValue(row, out var recent)) return (true, recent);
    for (var index = files.Count - 1; index >= 0; index--)
    {
        var file = files[index];
        if (useFilters && !MightHold(file.Filter, row)) continue; // the filter says this file cannot have it
        seeks++;
        if (file.Rows.TryGetValue(row, out var found)) return (true, found);
    }
    return (false, "");
}

var rows = new[] { "com.cnn.www", "com.google.maps", "org.wikipedia", "com.example", "net.apache", "com.github", "org.mozilla", "com.nytimes", "edu.mit", "gov.nasa", "org.python", "com.apple" };
Console.WriteLine("--- writes: each one is logged, then buffered, and a full memtable becomes a file");
for (var n = 0; n < rows.Length; n++)
{
    var filesBefore = files.Count;
    Write(rows[n], $"v{n + 1}");
    if (files.Count != filesBefore || n + 1 == rows.Length)
        Console.WriteLine($"after write {n + 1}: {files.Count} file(s), {memtable.Count} in the memtable, {log.Count} in the log, {compactions} merging compaction(s)");
}
Write("com.cnn.www", "v11");
Console.WriteLine($"rewrote com.cnn.www: the memtable has it now ({Read("com.cnn.www", false).Value}), the file still has the old one");

Console.WriteLine("--- reads: looking for rows that exist and rows that do not");
var missing = new[] { "org.nowhere", "com.absent", "net.missing", "edu.gone", "gov.none" };
seeks = 0;
foreach (var name in missing) Read(name, false);
var seeksWithout = seeks;
seeks = 0;
foreach (var name in missing) Read(name, true);
var seeksWith = seeks;
Console.WriteLine($"{missing.Length} lookups for missing rows: {seeksWithout} file reads without Bloom filters, {seeksWith} with them");
Console.WriteLine($"a lookup for com.google.maps returns {Read("com.google.maps", true).Value}");
var ok = seeksWith < seeksWithout && Read("com.cnn.www", true).Value == "v11" && files.Count <= MaxFiles && compactions >= 1;
Console.WriteLine($"checks {(ok ? "passed" : "FAILED")}");
if (!ok) Environment.Exit(1);
