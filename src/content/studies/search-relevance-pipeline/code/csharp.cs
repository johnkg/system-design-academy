// Learning from clicks without being fooled by position, in C#:
// the old ranking shows 8 products for one query, shoppers click more at the top, and we compare two ways to turn those clicks into a new order.
using System;
using System.Globalization;
using System.Linq;

int[] relevance = { 1, 0, 1, 3, 2, 0, 3, 1 };          // judged grade of each product, 0 (bad) to 3 (perfect); the old ranking shows them in this order
int[] examine = { 100, 60, 40, 30, 20, 15, 10, 8 };     // percent of shoppers who even look at each position
int[] clickIfSeen = { 2, 10, 30, 60 };                  // percent who click a product they looked at, by its grade

uint seed = 7;
int Random(int n) { seed = unchecked(seed * 1664525u + 1013904223u); return (int)((seed >> 16) % (uint)n); }

// Log 40,000 searches. Every search shows the products in the old order, so product i is always at position i.
const int searches = 40000;
var clicks = new int[8];
for (int s = 0; s < searches; s++)
    for (int pos = 0; pos < 8; pos++)
    {
        bool looked = Random(100) < examine[pos];
        if (looked && Random(100) < clickIfSeen[relevance[pos]]) clicks[pos]++;
    }

// Naive: click-through rate per product. It mixes "good product" with "shown near the top".
double[] naive = clicks.Select(c => (double)c / searches).ToArray();
// Inverse propensity: a click at a position that few people look at counts for more (divide by the chance of being looked at).
double[] ips = clicks.Select((c, pos) => (double)c / searches / (examine[pos] / 100.0)).ToArray();

int[] OrderBy(double[] score) => Enumerable.Range(0, score.Length).OrderBy(i => -score[i]).ThenBy(i => i).ToArray();
double Dcg(int[] order) { double sum = 0; for (int pos = 0; pos < order.Length; pos++) sum += ((1 << relevance[order[pos]]) - 1) / Math.Log2(pos + 2); return sum; }

int[] bestOrder = OrderBy(relevance.Select(r => (double)r).ToArray());
double ideal = Dcg(bestOrder);
double Ndcg(int[] order) => Dcg(order) / ideal;
string Join(int[] o) => string.Concat(o);
string F3(double v) => v.ToString("F3", CultureInfo.InvariantCulture);

int[] oldOrder = { 0, 1, 2, 3, 4, 5, 6, 7 };
int[] naiveOrder = OrderBy(naive);
int[] ipsOrder = OrderBy(ips);
Console.WriteLine("clicks by position: " + string.Join(" ", clicks));
Console.WriteLine($"old order   {Join(oldOrder)}  NDCG {F3(Ndcg(oldOrder))}");
Console.WriteLine($"naive CTR   {Join(naiveOrder)}  NDCG {F3(Ndcg(naiveOrder))}");
Console.WriteLine($"debiased    {Join(ipsOrder)}  NDCG {F3(Ndcg(ipsOrder))}");
Console.WriteLine($"ideal       {Join(bestOrder)}  NDCG {F3(Ndcg(bestOrder))}");

// The raw click rate puts a middling product on top just because it sat high; the debiased score finds both grade-3 products.
if (Ndcg(ipsOrder) <= Ndcg(naiveOrder) || ipsOrder[0] == 0 || Ndcg(ipsOrder) < 0.95) Environment.Exit(1);
