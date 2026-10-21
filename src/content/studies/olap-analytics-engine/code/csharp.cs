// A tiny OLAP engine in C#: events are rolled up into time-partitioned segments,
// each segment stores dictionary-encoded columns with bitmap indexes, and a query is
// scattered over the segments that can match and the partial sums are merged.
using System;
using System.Collections.Generic;
using System.Linq;

uint seed = 7;
int Rnd(int n) { seed = unchecked(seed * 1664525u + 1013904223u); return (int)((seed >> 16) % (uint)n); }

string[] countries = { "US", "DE", "FR", "JP", "BR", "IN" }, devices = { "ios", "web", "android" };
const int Window = 60, Bucket = 10; // a segment covers 60 minutes, rollup granularity is 10 minutes
const int Events = 6000;
const int Minutes = 240; // events fall in the first 4 hours
const int MaxMs = 500; // latency 1..500 ms
const int KeyStep = 100; // rollup key = bucket * KEY_STEP^2 + country * KEY_STEP + device
const int KeyBucket = KeyStep * KeyStep;
const int QueryFrom = 60; // the demo query covers minutes 60..179
const int QueryTo = 180;
var events = new List<(int T, int C, int D, int Ms)>();
for (int i = 0; i < Events; i++)
{
    int t = Rnd(Minutes);
    int c = Math.Min(Rnd(countries.Length), Rnd(countries.Length)); // countries are skewed
    int d = Rnd(devices.Length);
    int ms = 1 + Rnd(MaxMs);
    events.Add((t, c, d, ms));
}

// Dictionary encoding: sorted distinct values get small ids; a bitmap per id marks the rows holding it.
(List<string> Dict, int[][] Bitmaps) Encode(List<string> values)
{
    var dict = values.Distinct().OrderBy(v => v, StringComparer.Ordinal).ToList();
    var bitmaps = dict.Select(_ => new int[(values.Count + 15) >> 4]).ToArray();
    for (int row = 0; row < values.Count; row++) bitmaps[dict.IndexOf(values[row])][row >> 4] |= 1 << (row & 15);
    return (dict, bitmaps);
}

Segment BuildSegment(int start, IEnumerable<(int T, int C, int D, int Ms)> evs)
{
    var acc = new Dictionary<int, long[]>(); // rollup: one row per (bucket, country, device) with a count and a sum
    foreach (var e in evs)
    {
        int key = e.T / Bucket * KeyBucket + e.C * KeyStep + e.D;
        if (!acc.ContainsKey(key)) acc[key] = new long[2];
        acc[key][0] += 1; acc[key][1] += e.Ms;
    }
    var rows = acc.Keys.OrderBy(k => k).Select(k => new Row(k / KeyBucket * Bucket, countries[k / KeyStep % KeyStep], devices[k % KeyStep], acc[k][0], acc[k][1])).ToList();
    return new Segment(start, start + Window, rows, Encode(rows.Select(r => r.Country).ToList()), Encode(rows.Select(r => r.Device).ToList()));
}

var segments = new List<Segment>();
for (int s = 0; s < Minutes; s += Window) segments.Add(BuildSegment(s, events.Where(e => e.T >= s && e.T < s + Window)));
Console.WriteLine($"raw events: {events.Count}, rolled-up rows: {segments.Sum(s => s.Rows.Count)} in {segments.Count} segments ({string.Join(", ", segments.Select(s => s.Rows.Count))})");
Console.WriteLine($"segment 1 country dictionary: {string.Join(",", segments[1].Country.Dict)}");

int[] OrBitmaps((List<string> Dict, int[][] Bitmaps) col, string[] names) // OR the bitmaps of every wanted value that this segment knows
{
    var output = new int[col.Bitmaps[0].Length];
    foreach (var n in names)
    {
        int id = col.Dict.IndexOf(n);
        if (id >= 0) for (int i = 0; i < output.Length; i++) output[i] |= col.Bitmaps[id][i];
    }
    return output;
}

// One segment's share of the work: filter with bitmaps, then aggregate only the matching rows.
(Dictionary<int, long[]> Part, int Matched) ScanSegment(Segment seg, int from, int to, string[] want, string device)
{
    var a = OrBitmaps(seg.Country, want); var b = OrBitmaps(seg.Device, new[] { device });
    var part = new Dictionary<int, long[]>(); int matched = 0;
    for (int row = 0; row < seg.Rows.Count; row++)
    {
        var r = seg.Rows[row];
        if (((a[row >> 4] & b[row >> 4]) >> (row & 15) & 1) == 0 || r.Bucket < from || r.Bucket >= to) continue;
        if (!part.ContainsKey(r.Bucket)) part[r.Bucket] = new long[2];
        part[r.Bucket][0] += r.Count; part[r.Bucket][1] += r.Sum; matched++;
    }
    return (part, matched);
}

// Scatter to segments that overlap the time range, then gather.
var merged = new Dictionary<int, long[]>(); int scanned = 0, matchedRows = 0;
foreach (var seg in segments)
{
    if (seg.End <= QueryFrom || seg.Start >= QueryTo) continue; // pruned by time range
    scanned++;
    var (part, m) = ScanSegment(seg, QueryFrom, QueryTo, new[] { "DE", "FR" }, "ios");
    matchedRows += m;
    foreach (var (bucket, v) in part)
    {
        if (!merged.ContainsKey(bucket)) merged[bucket] = new long[2];
        merged[bucket][0] += v[0]; merged[bucket][1] += v[1];
    }
}
foreach (var b in merged.Keys.OrderBy(k => k)) Console.WriteLine($"minute {b}: {merged[b][0]} events, avg {merged[b][1] / merged[b][0]} ms");
Console.WriteLine($"segments scanned: {scanned} of {segments.Count}, rolled rows matched: {matchedRows}");

// The rolled-up answer must equal a brute-force pass over the raw events.
var raw = new Dictionary<int, long[]>();
foreach (var e in events)
{
    if (e.T < QueryFrom || e.T >= QueryTo || e.D != 0 || (e.C != 1 && e.C != 2)) continue;
    int b = e.T / Bucket * Bucket;
    if (!raw.ContainsKey(b)) raw[b] = new long[2];
    raw[b][0] += 1; raw[b][1] += e.Ms;
}
bool same = raw.Count == merged.Count && raw.All(kv => merged.ContainsKey(kv.Key) && merged[kv.Key][0] == kv.Value[0] && merged[kv.Key][1] == kv.Value[1]);
Console.WriteLine($"matches brute force over raw events: {(same ? "true" : "false")}");
if (!same || scanned != 2) Environment.Exit(1);

record Row(int Bucket, string Country, string Device, long Count, long Sum);
record Segment(int Start, int End, List<Row> Rows, (List<string> Dict, int[][] Bitmaps) Country, (List<string> Dict, int[][] Bitmaps) Device);
