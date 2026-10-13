// A small IVF (inverted file) vector index in C#:
// k-means splits the vectors into lists, a query scans only the nearest lists, and we measure recall against an exact scan.
using System;
using System.Collections.Generic;
using System.Linq;

const int Dim = 8, N = 2000, Lists = 16, K = 10, Queries = 50;

uint seed = 7;
int Rand(int n) { seed = unchecked(seed * 1664525u + 1013904223u); return (int)((seed >> 8) % (uint)n); }

int Dist(int[] a, int[] b) { int s = 0; for (int i = 0; i < Dim; i++) s += (a[i] - b[i]) * (a[i] - b[i]); return s; } // squared distance, integers only
int[] Near(int[] c) => c.Select(x => Math.Min(255, Math.Max(0, x + Rand(121) - 60))).ToArray();

var centers = Enumerable.Range(0, 24).Select(_ => Enumerable.Range(0, Dim).Select(__ => Rand(256)).ToArray()).ToArray();
var vectors = new List<int[]>();
for (int i = 0; i < N; i++) vectors.Add(Near(centers[Rand(24)]));
bool OnSale(int id) => id % 10 == 0; // 10% of vectors carry the filter tag

int Closest(int[] v, List<int[]> items)
{
    int best = 0;
    for (int i = 0; i < items.Count; i++) if (Dist(v, items[i]) < Dist(v, items[best])) best = i;
    return best;
}

// Training: a few rounds of k-means with integer centroids.
var cents = Enumerable.Range(0, Lists).Select(i => (int[])vectors[i * (N / Lists)].Clone()).ToList();
for (int round = 0; round < 5; round++)
{
    var sums = Enumerable.Range(0, Lists).Select(_ => new int[Dim]).ToArray();
    var counts = new int[Lists];
    foreach (var v in vectors) { int c = Closest(v, cents); counts[c]++; for (int i = 0; i < Dim; i++) sums[c][i] += v[i]; }
    for (int c = 0; c < Lists; c++) if (counts[c] > 0) cents[c] = sums[c].Select(s => s / counts[c]).ToArray();
}
var lists = Enumerable.Range(0, Lists).Select(_ => new List<int>()).ToArray();
for (int id = 0; id < N; id++) lists[Closest(vectors[id], cents)].Add(id);

string Hundredths(long n) => $"{n / 100}.{n % 100:00}"; // 2 decimals without float formatting
IEnumerable<(int d, int id)> Sorted(IEnumerable<(int d, int id)> hits) => hits.OrderBy(h => h.d).ThenBy(h => h.id);

(List<int> ids, int scanned) Search(int[] q, int nprobe, Func<int, bool>? accept = null)
{
    var order = Sorted(cents.Select((c, i) => (Dist(q, c), i))).Take(nprobe).Select(e => e.id).ToList();
    var hits = new List<(int d, int id)>(); int scanned = 0;
    foreach (var l in order) foreach (var id in lists[l]) { scanned++; if (accept == null || accept(id)) hits.Add((Dist(q, vectors[id]), id)); }
    return (Sorted(hits).Take(K).Select(h => h.id).ToList(), scanned);
}
List<int> Exact(int[] q, Func<int, bool>? accept = null) =>
    Sorted(vectors.Select((v, id) => (Dist(q, v), id)).Where(e => accept == null || accept(e.id))).Take(K).Select(e => e.id).ToList();

var queries = new List<int[]>();
for (int i = 0; i < Queries; i++) queries.Add(Near(vectors[Rand(N)]));

Console.WriteLine($"lists hold {lists.Min(l => l.Count)} to {lists.Max(l => l.Count)} vectors");
long last = 0;
foreach (int nprobe in new[] { 1, 2, 4, 8, 16 })
{
    long found = 0, scanned = 0;
    foreach (var q in queries) { var (ids, s) = Search(q, nprobe); var truth = Exact(q); found += ids.Count(i => truth.Contains(i)); scanned += s; }
    long recall = found * 100 / (Queries * K);
    Console.WriteLine($"nprobe {nprobe}: recall@{K} {recall}%, scans {scanned / Queries} of {N} vectors");
    if (recall < last) return 1;
    last = recall;
}
if (last != 100) return 1;

long post = 0, during = 0, duringHits = 0;
foreach (var q in queries)
{
    post += Search(q, 2).ids.Count(OnSale);                 // filter after the search: only what is left of the top 10
    var r = Search(q, 2, OnSale); during += r.ids.Count;    // filter while scanning: the top 10 of the matching vectors
    var truth = Exact(q, OnSale); duringHits += r.ids.Count(i => truth.Contains(i));
}
Console.WriteLine($"filter 'sale' (10%), nprobe 2: after the search {Hundredths(post * 100 / Queries)} results on average, during the scan {Hundredths(during * 100 / Queries)}");
Console.WriteLine($"filtered recall {duringHits * 100 / during}%");
return post >= during ? 1 : 0;
