// An order state machine and a courier dispatcher, in C#:
// every order change is checked against a table of legal moves and the version the caller saw,
// and a window of orders is assigned to couriers by cost instead of nearest-first.
using System;
using System.Collections.Generic;
using System.Linq;

public record Pos(int X, int Y);
public record Job(Pos Rest, int Ready);
public record Totals(int Travel, int Food, int Idle, int Cost);

public class Order
{
    static readonly Dictionary<string, string[]> Legal = new()
    {
        ["placed"] = new[] { "accepted", "cancelled" },
        ["accepted"] = new[] { "preparing", "cancelled" },
        ["preparing"] = new[] { "picked_up", "cancelled" },
        ["picked_up"] = new[] { "delivered" },
        ["delivered"] = Array.Empty<string>(),
        ["cancelled"] = Array.Empty<string>(),
    };
    public string State = "placed";
    public int Version = 1;
    public List<string> Log = new() { "placed" };
    readonly Dictionary<string, string> seen = new();

    // The caller names the version it saw and a request id. Only the first matching request wins; a repeat gets the old answer.
    public string Move(string to, int expectedVersion, string requestId)
    {
        if (seen.TryGetValue(requestId, out var old)) return old + " (repeat)";
        string result;
        if (expectedVersion != Version) result = "stale";
        else if (!Legal[State].Contains(to)) result = "illegal";
        else { State = to; Version++; Log.Add(to); result = "ok"; }
        seen[requestId] = result;
        return result;
    }
}

public static class Dispatch
{
    static long seed = 42;
    public static int Rnd(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)((seed / 65536) % n); }
    public static int Dist(Pos a, Pos b) => Math.Abs(a.X - b.X) + Math.Abs(a.Y - b.Y);
    // One cell takes one minute. Cold food counts double.
    public static (int Travel, int Food, int Idle) Detail(Pos c, Job o) { int t = Dist(c, o.Rest); return (t, Math.Max(0, t - o.Ready), Math.Max(0, o.Ready - t)); }
    public static int Cost(Pos c, Job o) { var d = Detail(c, o); return 2 * d.Food + d.Idle + d.Travel; }

    public static List<int> NearestFirst(List<Job> orders, List<Pos> couriers) // each order in turn takes the closest courier that is left
    {
        var free = Enumerable.Range(0, couriers.Count).ToList(); var pick = new List<int>();
        foreach (var o in orders)
        {
            int best = -1;
            foreach (int j in free) if (best < 0 || Dist(couriers[j], o.Rest) < Dist(couriers[best], o.Rest)) best = j;
            free.Remove(best); pick.Add(best);
        }
        return pick;
    }

    // Try every way of pairing, which is fine for a small window (the real thing uses the Hungarian algorithm).
    public static List<int> BestAssignment(List<Job> orders, List<Pos> couriers)
    {
        List<int>? best = null; int bestSum = 0; var used = new HashSet<int>(); var cur = new List<int>();
        void Go(int i, int sum)
        {
            if (best != null && sum >= bestSum) return;
            if (i == orders.Count) { best = new List<int>(cur); bestSum = sum; return; }
            for (int j = 0; j < couriers.Count; j++)
                if (used.Add(j)) { cur.Add(j); Go(i + 1, sum + Cost(couriers[j], orders[i])); cur.RemoveAt(cur.Count - 1); used.Remove(j); }
        }
        Go(0, 0);
        return best!;
    }

    public static Totals Sum(List<Job> orders, List<Pos> couriers, List<int> pick)
    {
        int tr = 0, f = 0, id = 0, c = 0;
        for (int i = 0; i < pick.Count; i++) { var d = Detail(couriers[pick[i]], orders[i]); tr += d.Travel; f += d.Food; id += d.Idle; c += Cost(couriers[pick[i]], orders[i]); }
        return new Totals(tr, f, id, c);
    }
}

public static class Program
{
    public static int Main()
    {
        var order = new Order();
        var calls = new (string To, int V, string R)[] {
            ("accepted", 1, "r1"), ("cancelled", 1, "r2"),   // the cancel saw version 1, but the accept already made it version 2
            ("preparing", 2, "r3"), ("delivered", 3, "r4"),  // delivered cannot follow preparing
            ("picked_up", 3, "r5"), ("delivered", 4, "r6"), ("delivered", 4, "r6"), // the last one is a repeated tap
            ("preparing", 5, "r7"),                           // nothing can follow delivered
        };
        foreach (var (to, v, r) in calls) Console.WriteLine($"{to} (saw v{v}, {r}): {order.Move(to, v, r)}");
        Console.WriteLine($"final: {order.State} v{order.Version}, log: {string.Join(" > ", order.Log)}");
        if (order.Version != order.Log.Count || order.State != "delivered") return 1;

        int[] a = new int[4], b = new int[4]; int strictlyBetter = 0;
        for (int trial = 0; trial < 200; trial++) // 200 windows of 6 orders and 6 couriers
        {
            var orders = Enumerable.Range(0, 6).Select(_ => { var p = new Pos(Dispatch.Rnd(20), Dispatch.Rnd(20)); return new Job(p, 4 + Dispatch.Rnd(12)); }).ToList();
            var couriers = Enumerable.Range(0, 6).Select(_ => new Pos(Dispatch.Rnd(20), Dispatch.Rnd(20))).ToList();
            var x = Dispatch.Sum(orders, couriers, Dispatch.NearestFirst(orders, couriers));
            var y = Dispatch.Sum(orders, couriers, Dispatch.BestAssignment(orders, couriers));
            if (y.Cost > x.Cost) return 1; // the best assignment can never be worse
            if (y.Cost < x.Cost) strictlyBetter++;
            a[0] += x.Travel; a[1] += x.Food; a[2] += x.Idle; a[3] += x.Cost;
            b[0] += y.Travel; b[1] += y.Food; b[2] += y.Idle; b[3] += y.Cost;
        }
        Console.WriteLine($"{"nearest",-8} travel {a[0]} min, food waiting {a[1]} min, courier waiting {a[2]} min, cost {a[3]}");
        Console.WriteLine($"{"window",-8} travel {b[0]} min, food waiting {b[1]} min, courier waiting {b[2]} min, cost {b[3]}");
        Console.WriteLine($"the window assignment was strictly cheaper in {strictlyBetter} of 200 windows");
        return b[3] < a[3] ? 0 : 1;
    }
}
