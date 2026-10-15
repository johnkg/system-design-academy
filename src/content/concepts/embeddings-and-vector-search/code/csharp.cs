// A tiny IVF (inverted file) index over 2D points: k-means-lite lists, nprobe search, recall vs brute force.
// Integer maths and a seeded LCG keep the output identical in every language.
using System;
using System.Collections.Generic;
using System.Linq;

long seed = 12345;
long Rnd() { seed = (seed * 48271) % 2147483647; return seed; }

const int N = 2000, CLUSTERS = 24, NLIST = 32, K = 10, Q = 40;
var cx = new long[CLUSTERS]; var cy = new long[CLUSTERS];
for (int c = 0; c < CLUSTERS; c++) { cx[c] = Rnd() % 8000 + 1000; cy[c] = Rnd() % 8000 + 1000; }
long Jitter() { long a = Rnd() % 1601, b = Rnd() % 1601, c = Rnd() % 1601; return a + b + c - 2400; }
var px = new long[N]; var py = new long[N]; var tag = new int[N];
for (int i = 0; i < N; i++) { int t = i % CLUSTERS; tag[i] = t; px[i] = cx[t] + Jitter(); py[i] = cy[t] + Jitter(); }
var qs = new (long x, long y)[Q];
for (int i = 0; i < Q; i++) { int t = (int)(Rnd() % CLUSTERS); long x = cx[t] + Jitter(); long y = cy[t] + Jitter(); qs[i] = (x, y); }
long D2(long ax, long ay, long bx, long by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

// Build: Lloyd's k-means for 6 rounds, starting from evenly spaced points.
var mx = new long[NLIST]; var my = new long[NLIST];
for (int c = 0; c < NLIST; c++) { mx[c] = px[c * N / NLIST]; my[c] = py[c * N / NLIST]; }
int Nearest(long x, long y)
{
    int b = 0; long bd = D2(x, y, mx[0], my[0]);
    for (int c = 1; c < NLIST; c++) { long d = D2(x, y, mx[c], my[c]); if (d < bd) { bd = d; b = c; } }
    return b;
}
for (int it = 0; it < 6; it++)
{
    var sx = new long[NLIST]; var sy = new long[NLIST]; var n = new long[NLIST];
    for (int i = 0; i < N; i++) { int c = Nearest(px[i], py[i]); sx[c] += px[i]; sy[c] += py[i]; n[c]++; }
    for (int c = 0; c < NLIST; c++) if (n[c] > 0) { mx[c] = sx[c] / n[c]; my[c] = sy[c] / n[c]; }
}
var lists = Enumerable.Range(0, NLIST).Select(_ => new List<int>()).ToArray();
for (int i = 0; i < N; i++) lists[Nearest(px[i], py[i])].Add(i);

// Search: rank centroids, scan the nprobe closest lists, keep the K best. filter < 0 means no metadata filter.
(List<int> top, int work) Search((long x, long y) q, int nprobe, int filter, bool everything)
{
    var order = Enumerable.Range(0, NLIST).OrderBy(c => D2(q.x, q.y, mx[c], my[c])).ThenBy(c => c).ToList();
    var ids = everything ? Enumerable.Range(0, N).ToList() : order.Take(nprobe).SelectMany(c => lists[c]).ToList();
    var cand = new List<long>(); int work = 0;
    foreach (int i in ids)
        if (filter < 0 || tag[i] == filter) { work++; cand.Add(D2(q.x, q.y, px[i], py[i]) * 4096 + i); }
    cand.Sort();
    return (cand.Take(K).Select(v => (int)(v % 4096)).ToList(), work + (everything ? 0 : NLIST));
}
(long hits, long total, long avg, long returned) Run(int nprobe, int filter, bool post)
{
    long hits = 0, work = 0, returned = 0;
    foreach (var q in qs)
    {
        var truth = new HashSet<int>(Search(q, 0, filter, true).top);
        var (top, w) = Search(q, nprobe, post ? -1 : filter, false);
        if (post) top = top.Where(i => tag[i] == filter).ToList();
        work += w; returned += top.Count; hits += top.Count(i => truth.Contains(i));
    }
    return (hits, (long)Q * K, work / Q, returned);
}

Console.WriteLine($"points={N} lists={NLIST} sizes={string.Join(",", lists.Select(l => l.Count))}");
long prevHits = -1, prevAvg = -1, lastHits = 0, lastTotal = 0;
foreach (int p in new[] { 1, 2, 4, 8, 32 })
{
    var r = Run(p, -1, false);
    Console.WriteLine($"nprobe={p} recall@{K}={r.hits}/{r.total} ({r.hits * 100 / r.total}%) distance computations per query={r.avg} (brute force {N})");
    if (r.hits < prevHits || r.avg < prevAvg) return 1;
    prevHits = r.hits; prevAvg = r.avg; lastHits = r.hits; lastTotal = r.total;
}
if (lastHits != lastTotal) return 1; // probing every list is exact
foreach (int p in new[] { 1, 4, 32 })
{
    var pre = Run(p, 3, false); var post = Run(p, 3, true);
    Console.WriteLine($"filter tag=3 nprobe={p}: pre-filter recall={pre.hits * 100 / pre.total}% post-filter recall={post.hits * 100 / post.total}% post-filter results returned={post.returned}/{post.total}");
}
// Memory: 10M vectors of 768 dimensions.
long V = 10000000, Dim = 768, MB = 1000000;
Console.WriteLine($"float32 {V * Dim * 4 / MB} MB, int8 {V * Dim / MB} MB, product quantisation (96 bytes per vector) {V * 96 / MB} MB");
return 0;
