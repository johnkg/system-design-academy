// A miniature of Dremel from Google's VLDB 2010 paper, in C# (a teaching model, not Google's code):
// nested records are stored column by column with repetition and definition levels (the paper's own two sample records and its
// Name.Language.Code column), the column alone is enough to rebuild the nesting or to count values within each record, and a
// serving tree of a root, intermediate servers and leaves aggregates partial counts, with a dispatcher that re-sends slow
// tablets or returns when a minimum share of tablets has been scanned. Everything is deterministic.

using System;
using System.Collections.Generic;
using System.Linq;

// The paper's records r1 and r2, trimmed to the fields used here: each Name is the list of Language codes it has, or empty.
var records = new List<List<List<string>>>
{
    new() { new() { "en-us", "en" }, new(), new() { "en-gb" } }, // r1: three Names
    new() { new() },                                              // r2: one Name without a Language
};

// Column Name.Language.Code: Name and Language repeat, Code is required, so the largest definition level is 2.
List<(string? Value, int R, int D)> Stripe(List<List<List<string>>> recs)
{
    var column = new List<(string?, int, int)>();
    foreach (var rec in recs)
    {
        if (rec.Count == 0) { column.Add((null, 0, 0)); continue; }
        for (int n = 0; n < rec.Count; n++)
        {
            var langs = rec[n];
            if (langs.Count == 0) { column.Add((null, n == 0 ? 0 : 1, 1)); continue; } // a Name without a Language: defined down to Name only
            for (int l = 0; l < langs.Count; l++)
                column.Add((langs[l], n == 0 && l == 0 ? 0 : l == 0 ? 1 : 2, 2));
        }
    }
    return column;
}
var column = Stripe(records);
Console.WriteLine("--- the column Name.Language.Code as (value, repetition level, definition level)");
foreach (var (v, r, d) in column) Console.WriteLine($"{v ?? "NULL"}  r={r}  d={d}");

// Rebuild the nesting of this one column from the levels alone.
List<List<List<string>>> Assemble(List<(string? Value, int R, int D)> col)
{
    var output = new List<List<List<string>>>();
    foreach (var (value, r, d) in col)
    {
        if (r == 0) output.Add(new()); // a new record starts
        if (d == 0) continue; // the record has no Name at all
        if (r <= 1) output[^1].Add(new()); // a new Name starts
        if (d >= 2) output[^1][^1].Add(value!); // a Language with this Code
    }
    return output;
}
Console.WriteLine("--- rebuilt from the levels alone (one list per Name)");
var rebuilt = Assemble(column);
for (int i = 0; i < rebuilt.Count; i++)
    Console.WriteLine($"r{i + 1}: [" + string.Join(",", rebuilt[i].Select(name => "[" + string.Join(",", name.Select(c => $"\"{c}\"")) + "]")) + "]");

// COUNT(Name.Language.Code) within each record, straight from the column: a value with definition level 2 counts, a record starts at r=0.
var counts = new List<int>();
foreach (var (_, r, d) in column) { if (r == 0) counts.Add(0); if (d == 2) counts[^1]++; }
Console.WriteLine($"--- within-record counts without assembling any record: {string.Join(", ", counts)}");

// A serving tree: root -> 2 intermediate servers -> 4 leaves, 12 tablets. Every tablet takes 100 ms except tablet 7, a straggler.
Console.WriteLine("--- a query over 12 tablets on a serving tree");
const int Tablets = 12, Leaves = 4, Normal = 100, Threshold = 3 * Normal; // a tablet is a straggler once it has run 3 times the usual time
int Count(int t) => t * 7 % 5 + 1; // each tablet's partial COUNT
int Time(int t) => t == 7 ? 1000 : Normal;
int Total(IEnumerable<int> ts) => ts.Sum(Count);
var all = Enumerable.Range(0, Tablets).ToList();
var byLeaf = Enumerable.Range(0, Leaves).Select(l => all.Where(t => t % Leaves == l).ToList()).ToList();
var intermediate = new[] { byLeaf[0].Concat(byLeaf[1]).ToList(), byLeaf[2].Concat(byLeaf[3]).ToList() };
Console.WriteLine($"partial counts added up the tree: {string.Join(" + ", intermediate.Select(ts => Total(ts)))} = {Total(all)}");
var finish = new Dictionary<int, int>();
foreach (var ts in byLeaf)
{
    int t = 0;
    foreach (var tablet in ts) { t += Time(tablet); finish[tablet] = t; }
}
Console.WriteLine($"no mitigation: the query waits for the straggler and takes {finish.Values.Max()} ms");
Console.WriteLine($"straggler re-sent to an idle leaf after 3 x the usual tablet time ({Threshold} ms): the query takes {Threshold + Normal} ms");
var ordered = finish.OrderBy(p => p.Value).ToList();
int needed = (int)Math.Ceiling(0.83 * Tablets);
var early = ordered.Take(needed).ToList();
Console.WriteLine($"return once {needed} of {Tablets} tablets are scanned ({(int)Math.Floor(100.0 * needed / Tablets + 0.5)}%): {early[^1].Value} ms, count {Total(early.Select(p => p.Key))} instead of {Total(all)}");
