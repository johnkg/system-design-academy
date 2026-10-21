// A rolling-update planner. Given max surge and max unavailable, it produces the sequence of steps
// (start a v2 server, stop a v1 server) and checks that capacity never drops below the minimum.
// Integers only and no clock: one tick is one second, so the output is the same every run.

using System;
using System.Collections.Generic;
using System.Linq;

const int N = 6, Delay = 2, Needed = 5; // 6 servers, 2 s until ready, demand needs 5 ready servers
foreach (var (surge, unavailable) in new[] { (1, 0), (0, 1), (2, 2), (0, 0) })
{
    string label = $"surge={surge} unavailable={unavailable}";
    List<Row> rows;
    try { rows = Planner.Plan(N, surge, unavailable, Delay); }
    catch (ArgumentException)
    {
        Console.WriteLine($"{label}: rejected (no progress possible)");
        continue;
    }
    var (low, high) = Planner.Verify(rows, N, surge, unavailable);
    if (surge == 1 && unavailable == 0)
        foreach (var r in rows)
            Console.WriteLine($"t={r.T,2} v1={r.Old} v2={r.New} starting={r.Starting} ready={r.Ready} total={r.Total} +{r.Started} -{r.Stopped}");
    int mixed = rows.Count(r => r.Old > 0 && r.New > 0);
    Console.WriteLine($"{label}: {rows.Count} ticks, min ready={low}, max servers={high}, mixed-version ticks={mixed}, keeps {Needed} ready: {(low >= Needed).ToString().ToLower()}");
}

// Blue-green needs no step plan: start N green servers, wait, flip the router once.
Console.WriteLine($"blue-green: peak servers={2 * N}, ready after {Delay} ticks, mixed-version ticks=0, rollback=1 router flip");

record Row(int T, int Old, int New, int Starting, int Ready, int Total, int Started, int Stopped);

static class Planner
{
    const int MaxTicks = 200; // safety limit: give up if a rollout has not finished by then

    public static List<Row> Plan(int n, int maxSurge, int maxUnavailable, int readyAfter)
    {
        if (maxSurge == 0 && maxUnavailable == 0) throw new ArgumentException("surge 0 and unavailable 0 can never make progress");
        int old = n; // v1 servers, all ready
        int newReady = 0; // ready v2 servers
        var starting = new List<int>(); // countdowns for v2 servers that are still booting
        var rows = new List<Row>();
        for (int tick = 0; tick < MaxTicks; tick++)
        {
            int started = 0, stopped = 0;
            while (true)
            {
                int newCount = newReady + starting.Count;
                int total = old + newCount;
                if (newCount < n && total < n + maxSurge)
                {
                    starting.Add(readyAfter); // surge: bring up a v2 server first
                    started++;
                }
                else if (old > 0 && old + newReady - 1 >= n - maxUnavailable)
                {
                    old--; // safe to remove: the ready count stays at or above n - maxUnavailable
                    stopped++;
                }
                else break;
            }
            rows.Add(new Row(tick, old, newReady, starting.Count, old + newReady, old + newReady + starting.Count, started, stopped));
            if (old == 0 && newReady == n) return rows;
            starting = starting.Select(x => x - 1).ToList(); // time passes: boot and readiness checks progress
            newReady += starting.Count(x => x <= 0);
            starting = starting.Where(x => x > 0).ToList();
        }
        throw new InvalidOperationException("rollout did not finish");
    }

    public static (int Low, int High) Verify(List<Row> rows, int n, int maxSurge, int maxUnavailable)
    {
        foreach (var r in rows)
        {
            if (r.Total > n + maxSurge) throw new Exception($"too many servers at t={r.T}");
            if (r.Ready < n - maxUnavailable) throw new Exception($"capacity below the allowed minimum at t={r.T}");
        }
        var last = rows[^1];
        if (last.New != n || last.Old != 0) throw new Exception("rollout incomplete");
        return (rows.Min(r => r.Ready), rows.Max(r => r.Total));
    }
}
