// Load shedding: the same 3x overload against three queue policies. Deterministic discrete-time simulation, integers only.
// One step is 100 ms. The server completes 10 requests per step (100 per second). Clients give up after 20 steps (2 s).
using System;
using System.Collections.Generic;

public static class Program
{
    const int Steps = 200, SpikeSteps = 100; // 20 s in total, the first 10 s overloaded
    const int Capacity = 10, Timeout = 20, Limit = 50;
    const int SpikeArrivals = 30, CalmArrivals = 6; // 300 per second, then 60 per second

    record Result(int Good, int Wasted, int Rejected, int Dropped, int Left, int AvgMs);

    static Result Run(string policy)
    {
        var queue = new List<int>(); int head = 0; // each entry is the step the request arrived in
        int good = 0, wasted = 0, rejected = 0, dropped = 0, latSum = 0;
        for (int step = 0; step < Steps; step++)
        {
            int arrivals = step < SpikeSteps ? SpikeArrivals : CalmArrivals;
            for (int i = 0; i < arrivals; i++)
            {
                int waiting = queue.Count - head;
                if (policy == "bounded" && waiting >= Limit)
                {
                    rejected++; // fail fast: an immediate 503, no queueing, no work
                    continue;
                }
                if (policy == "lifo" && waiting >= Limit)
                {
                    head++; // drop the oldest: its caller is the most likely to be gone
                    dropped++;
                }
                queue.Add(step);
            }
            for (int i = 0; i < Capacity; i++)
            {
                if (queue.Count - head == 0) break;
                int arrived;
                if (policy == "lifo") { arrived = queue[^1]; queue.RemoveAt(queue.Count - 1); }
                else arrived = queue[head++];
                int latency = step - arrived + 1;
                if (latency <= Timeout)
                {
                    good++; // an answer the caller was still waiting for
                    latSum += latency * 100;
                }
                else wasted++; // the server was busy, but the caller had already left
            }
        }
        return new Result(good, wasted, rejected, dropped, queue.Count - head, good > 0 ? latSum / good : 0);
    }

    static void Check(bool ok, string msg)
    {
        if (!ok) { Console.Error.WriteLine("assertion failed: " + msg); Environment.Exit(1); }
    }

    public static void Main()
    {
        var fifo = Run("fifo"); var bounded = Run("bounded"); var lifo = Run("lifo");
        foreach (var (name, r) in new[] { ("fifo", fifo), ("bounded", bounded), ("lifo", lifo) })
            Console.WriteLine($"{name,-8} good={r.Good} wasted={r.Wasted} rejected={r.Rejected} dropped={r.Dropped} left={r.Left} avg_latency_ms={r.AvgMs}");

        Check(bounded.Good > fifo.Good, "fail-fast must beat an unbounded queue under 3x overload");
        Check(lifo.Good > fifo.Good && bounded.Wasted == 0 && fifo.Wasted > 0, "only the unbounded queue wastes work");
        Check(lifo.AvgMs < bounded.AvgMs, "newest-first answers faster than oldest-first");
        Check(fifo.Left > 0 && bounded.Left <= Limit, "the unbounded queue is still backed up");
        foreach (var r in new[] { fifo, bounded, lifo }) Check(r.Good + r.Wasted <= Capacity * Steps, "cannot serve more than capacity");
        Console.WriteLine("goodput ratio bounded/fifo: " + bounded.Good * 100 / fifo.Good + " percent");
    }
}
