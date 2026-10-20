// A road grid in C#: Dijkstra and A* find the same cheapest route, but A* settles far fewer cells.
// Each cell takes 2 or 3 minutes to cross, about one cell in eight is blocked, and a jam can make cells slower.
using System;
using System.Collections.Generic;
using System.Linq;

const int W = 24, H = 16, MinCost = 2, Inf = 1_000_000_000;
const int Start = 8 * W + 2, Goal = 8 * W + 21;

long seed = 7;
int NextRandom() { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)(seed / 65536); }

int[] MakeGrid()
{
    var cost = new int[W * H]; // cost[cell] = minutes to enter the cell, or 0 for a wall
    for (int i = 0; i < W * H; i++)
    {
        bool wall = NextRandom() % 8 == 0;
        cost[i] = wall ? 0 : MinCost + NextRandom() % 2;
    }
    cost[Start] = MinCost; cost[Goal] = MinCost; // start and goal are always open
    return cost;
}

// With useEstimate off this is Dijkstra. With it on, the straight-line (block) distance times the cheapest
// cell cost never overestimates, so the answer stays exact. The queue orders by (priority, cell), so ties break the same way everywhere.
(int cost, int settled, List<int> path) Route(int[] cost, int start, int goal, bool useEstimate)
{
    int gx = goal % W, gy = goal / W;
    int Estimate(int c) => useEstimate ? (Math.Abs(c % W - gx) + Math.Abs(c / W - gy)) * MinCost : 0;
    var best = Enumerable.Repeat(Inf, W * H).ToArray();
    var prev = Enumerable.Repeat(-1, W * H).ToArray();
    var done = new bool[W * H];
    var heap = new PriorityQueue<int, (int, int)>();
    best[start] = 0; heap.Enqueue(start, (Estimate(start), start));
    int settled = 0;
    var steps = new (int dx, int dy)[] { (1, 0), (-1, 0), (0, 1), (0, -1) };
    while (heap.Count > 0)
    {
        int c = heap.Dequeue();
        if (done[c]) continue;
        done[c] = true; settled++;
        if (c == goal) break;
        int x = c % W, y = c / W;
        foreach (var (dx, dy) in steps)
        {
            int nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            int n = ny * W + nx;
            if (cost[n] == 0) continue;
            if (best[c] + cost[n] < best[n]) { best[n] = best[c] + cost[n]; prev[n] = c; heap.Enqueue(n, (best[n] + Estimate(n), n)); }
        }
    }
    var path = new List<int>();
    for (int c = goal; c != -1; c = prev[c]) path.Add(c);
    path.Reverse();
    return (best[goal], settled, path);
}

int PathCost(int[] cost, List<int> path) => path.Skip(1).Sum(c => cost[c]);

int Compare(string label, int[] cost)
{
    var d = Route(cost, Start, Goal, false);
    var a = Route(cost, Start, Goal, true);
    int open = cost.Count(c => c > 0);
    Console.WriteLine($"{label}: Dijkstra cost {d.cost}, settled {d.settled} of {open} cells");
    Console.WriteLine($"{label}: A* cost {a.cost}, settled {a.settled} ({100 * a.settled / d.settled}% of Dijkstra)");
    bool same = d.cost == a.cost && PathCost(cost, d.path) == d.cost && PathCost(cost, a.path) == a.cost;
    Console.WriteLine($"{label}: same cost and both paths add up: {(same ? "true" : "false")}");
    if (!same || a.settled > d.settled || d.cost == Inf) Environment.Exit(1);
    return a.cost;
}

var grid = MakeGrid();
int before = Compare("free-flowing", grid);

// A jam: every cell in the middle block takes three times as long. The estimate still never overestimates, so A* stays exact.
var jammed = grid.Select((c, i) => c > 0 && i % W >= 8 && i % W < 16 && i / W >= 4 && i / W < 12 ? c * 3 : c).ToArray();
int after = Compare("with a jam", jammed);
Console.WriteLine($"the jam adds {after - before} minutes to the trip");
if (after < before) Environment.Exit(1);
