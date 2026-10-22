// A federation gateway's core in C#: plan a query across subgraphs, batch the entity fetches,
// reject expensive queries, and accept only persisted queries by hash.
using System;
using System.Collections.Generic;
using System.Linq;

var fields = new Dictionary<string, bool> { ["users"] = true, ["friends"] = true, ["orders"] = true, ["product"] = false, ["price"] = false };
const int MaxDepth = 5, MaxCost = 500, ListGuess = 10;

// The supergraph: whether each field returns a list. Lists are assumed to hold 10 items when costing.
const int Seed = 7, Users = 20, OrderSpread = 4, Products = 8; // each user has 0..3 orders
const int MinPrice = 10, PriceSpread = 90, PriceStride = 37; // prices 10..99, scattered by a fixed stride

ulong seed = Seed;
int Random(int n) { seed = (seed * 1664525UL + 1013904223UL) % 4294967296UL; return (int)((seed >> 16) % (ulong)n); }

// Subgraph data, keyed by entity id. Each subgraph only knows its own part.
var users = Enumerable.Range(0, Users).ToList();
var orders = new List<(int Id, int UserId, int ProductId)>();
foreach (var u in users) for (int k = Random(OrderSpread); k > 0; k--) orders.Add((orders.Count, u, Random(Products)));
var prices = Enumerable.Range(0, Products).Select(i => MinPrice + (i * PriceStride) % PriceSpread).ToArray();

(Dictionary<string, int> calls, int total) Execute(bool batch)
{
    var calls = new Dictionary<string, int>();
    void Hit(string name) => calls[name] = calls.GetValueOrDefault(name) + 1;
    List<int> UsersSg() { Hit("users"); return users.ToList(); }
    List<List<(int Id, int UserId, int ProductId)>> OrdersSg(List<int> ids) { Hit("orders"); return ids.Select(i => orders.Where(o => o.UserId == i).ToList()).ToList(); } // one batch call, answers in key order
    List<(int Id, int Price)> ProductsSg(List<int> ids) { Hit("products"); return ids.Select(i => (i, prices[i])).ToList(); }

    // Run the chain users -> orders -> product -> price. With batch, each level makes one call; without it, one call per parent.
    var userIds = UsersSg();
    var perUser = batch ? OrdersSg(userIds) : userIds.Select(i => OrdersSg(new List<int> { i })[0]).ToList();
    var every = perUser.SelectMany(g => g).ToList();
    var found = batch ? ProductsSg(every.Select(o => o.ProductId).Distinct().ToList())
                      : every.Select(o => ProductsSg(new List<int> { o.ProductId })[0]).ToList();
    var priceOf = new Dictionary<int, int>();
    foreach (var p in found) priceOf[p.Id] = p.Price;
    return (calls, every.Sum(o => priceOf[o.ProductId]));
}

// Analyse a query (a chain of field names) before running it: depth, and cost = number of objects it could touch.
(int depth, long cost, string verdict) Analyse(string[] path)
{
    long mult = 1, cost = 0;
    foreach (var f in path) { if (fields[f]) mult *= ListGuess; cost += mult; }
    var verdict = path.Length > MaxDepth ? "too deep" : cost > MaxCost ? "too costly" : "ok";
    return (path.Length, cost, verdict);
}

uint Fnv1a(string text) { uint h = 2166136261; foreach (var c in text) h = unchecked((h ^ c) * 16777619); return h; }
string Hex(uint h) => h.ToString("x8");
string Fmt(Dictionary<string, int> c) => "{" + string.Join(",", c.Select(kv => $"\"{kv.Key}\":{kv.Value}")) + "}";

var good = new[] { "users", "orders", "product", "price" };
var attack = new[] { "users", "friends", "friends", "friends", "friends", "friends" };
var wide = new[] { "users", "friends", "friends", "friends" };
var allowed = new HashSet<string> { Hex(Fnv1a(string.Join(".", good))) }; // the persisted-query registry, filled at deploy time
string Gate(string h) => allowed.Contains(h) ? "allowed" : "unknown hash, rejected";

var (naiveCalls, naiveTotal) = Execute(false);
var (batchedCalls, batchedTotal) = Execute(true);
Console.WriteLine($"orders: {orders.Count} across {users.Count} users");
Console.WriteLine($"naive calls: {Fmt(naiveCalls)}");
Console.WriteLine($"batched calls: {Fmt(batchedCalls)}");
Console.WriteLine($"sum of prices: naive {naiveTotal}, batched {batchedTotal}");
foreach (var (name, q) in new[] { ("good", good), ("wide", wide), ("attack", attack) })
{
    var (depth, cost, verdict) = Analyse(q);
    var h = Hex(Fnv1a(string.Join(".", q)));
    Console.WriteLine($"{name}: depth {depth}, cost {cost}, {verdict}, hash {h} {Gate(h)}");
}
bool same = naiveTotal == batchedTotal;
bool fewer = batchedCalls["orders"] == 1 && batchedCalls["products"] == 1 && naiveCalls["orders"] == users.Count;
Console.WriteLine($"same result: {(same ? "true" : "false")}; batching holds: {(fewer ? "true" : "false")}");
if (!same || !fewer || Analyse(good).verdict != "ok" || Analyse(attack).verdict == "ok") Environment.Exit(1);
