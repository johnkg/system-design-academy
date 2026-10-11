// A tiny column store with date partitions and zone maps, in C#:
// rows are cut into partitions by day, each column is encoded on its own, and a query reads only the columns and partitions it needs.
using System;
using System.Collections.Generic;
using System.Linq;

const int Rows = 6000, Days = 30, PartDays = 5, RowBytes = 14; // a row store keeps day 4 + country 2 + qty 4 + amount 4 bytes together
string[] countries = { "BR", "DE", "IN", "JP", "US" };
string[] columns = { "day", "country", "qty", "amount" };
var rawWidth = new Dictionary<string, int> { ["day"] = 4, ["country"] = 2, ["qty"] = 4, ["amount"] = 4 };

long seed = 7;
int Next(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296L; return (int)(seed / 65536 % n); }
int BytesFor(int max) => max < 256 ? 1 : max < 65536 ? 2 : 4; // the narrowest whole number of bytes that holds the biggest value

var rows = new List<Row>();
for (int i = 0; i < Rows; i++)
{
    int country = Next(5), qty = 1 + Next(5), amount = 1 + Next(500);
    rows.Add(new Row(i * Days / Rows, country, qty, amount)); // rows arrive in date order
}

// Cut into partitions by day. Inside a partition sort by country (the sort key), so equal countries sit in long runs.
var parts = new List<Part>();
for (int p = 0; p < Days / PartDays; p++)
{
    var items = rows.Where(r => r.Day / PartDays == p).OrderBy(r => r.Country).ToList();
    int n = items.Count, minDay = items.Min(r => r.Day), maxDay = items.Max(r => r.Day); // the zone map of this partition
    int runs = 0;
    for (int i = 0; i < n; i++) if (i == 0 || items[i].Country != items[i - 1].Country) runs++;
    var size = new Dictionary<string, int>
    {
        ["day"] = BytesFor(maxDay - minDay) * n,                  // delta from the partition's first day
        ["country"] = runs * 3,                                   // run-length: 1 byte code + 2 bytes count per run
        ["qty"] = BytesFor(items.Max(r => r.Qty)) * n,            // bit-packed to the width the values need
        ["amount"] = BytesFor(items.Max(r => r.Amount)) * n,
    };
    parts.Add(new Part(minDay, maxDay, n, items, size));
}

// Read the wanted columns of the partitions that can hold days lo..hi. Returns bytes read and the matching rows.
(int Bytes, int Scanned, int RowsRead, List<Row> Hit) Scan(string[] want, int lo, int hi, bool prune)
{
    int bytes = 0, scanned = 0, rowsRead = 0;
    var hit = new List<Row>();
    foreach (var p in parts)
    {
        if (prune && (p.MaxDay < lo || p.MinDay > hi)) continue;  // the zone map proves nothing here can match
        bool inside = p.MinDay >= lo && p.MaxDay <= hi;           // every row matches, so the day column is not needed
        var need = prune && inside ? want : want.Union(new[] { "day" }).ToArray();
        bytes += need.Sum(c => p.Size[c]);
        scanned++; rowsRead += p.N;
        hit.AddRange(p.Items.Where(r => r.Day >= lo && r.Day <= hi));
    }
    return (bytes, scanned, rowsRead, hit);
}

int Total(IEnumerable<Row> hit) => hit.Sum(r => r.Amount);

Console.WriteLine($"{Rows} rows in {parts.Count} partitions of {PartDays} days");
foreach (var c in columns)
    Console.WriteLine($"column {c}: {Rows * rawWidth[c]} B raw -> {parts.Sum(p => p.Size[c])} B encoded");

const int Lo = 17, Hi = 24;
var inRange = rows.Where(r => r.Day >= Lo && r.Day <= Hi).ToList();
var queries = new (string Name, string[] Want, Func<List<Row>, string> Answer)[]
{
    ("sum(amount)", new[] { "amount" }, hit => Total(hit).ToString()),
    ("sum(amount) by country", new[] { "country", "amount" },
        hit => string.Join(" ", countries.Select((c, i) => $"{c}={Total(hit.Where(r => r.Country == i))}"))),
    ("select *", columns, hit => $"{hit.Count} rows, amount total {Total(hit)}"),
};
int rowStore = Rows * RowBytes;
foreach (var (name, want, answer) in queries)
{
    var all = Scan(want, Lo, Hi, false);
    var pruned = Scan(want, Lo, Hi, true);
    string result = answer(pruned.Hit);
    Console.WriteLine($"{name} where day {Lo}..{Hi}: {result}");
    Console.WriteLine($"  row store {rowStore} B | row store, same partitions {pruned.RowsRead * RowBytes} B | columns {all.Bytes} B | columns + zone maps {pruned.Bytes} B ({pruned.Scanned} of {parts.Count} partitions)");
    if (result != answer(inRange) || result != answer(all.Hit)) Environment.Exit(1); // same answer as a plain loop over the rows
    if (!(pruned.Bytes < all.Bytes && all.Bytes < rowStore && pruned.Scanned == 2)) Environment.Exit(1);
}

record Row(int Day, int Country, int Qty, int Amount);
record Part(int MinDay, int MaxDay, int N, List<Row> Items, Dictionary<string, int> Size);
