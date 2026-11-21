// Producer-consumer: a tick simulation (no real threads, no clock) of one producer feeding 3 consumers through a queue.
// The producer offers `rate` items per tick for 60 ticks. Each consumer needs 2 ticks per item, so the consumers can
// take 1.5 items per tick. The queue is unbounded or holds at most `bound` items, and when it is full the producer is
// blocked, or the new item is dropped, or the oldest queued item is dropped.
// With `retry` on, every 4th item fails once and its consumer puts it back on the SAME queue to try again.
// Look for: rate 2 is more than the consumers can take, so an unbounded queue just grows; a bound turns that into
// waiting (block) or loss (drop); blocking plus retry-on-the-same-queue can deadlock.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const int Ticks = 60, Consumers = 3, Service = 2;

    class Item { public int Id, Enq; public bool Failed; }
    class Consumer { public string State = "idle"; public int Rem; public Item Item; }
    class Outcome { public int Total, Processed, Lost, FirstLost = -1, Peak, MaxWait, Blocked, Tick; public bool Deadlock; }

    static Outcome Simulate(int rate, int bound, string policy, bool retry)
    {
        int total = rate * Ticks;
        var queue = new List<Item>();
        var cons = new Consumer[Consumers];
        for (int i = 0; i < Consumers; i++) cons[i] = new Consumer();
        var r = new Outcome { Total = total };
        int produced = 0;
        bool Full() => bound > 0 && queue.Count >= bound;
        // Offers an item to the queue under the policy. Returns true if it was handled (queued or dropped), false if blocked.
        bool Offer(Item item, int t)
        {
            if (!Full()) { item.Enq = t; queue.Add(item); return true; }
            if (policy == "block") return false;
            if (policy == "dropNew") { r.Lost++; if (r.FirstLost < 0) r.FirstLost = item.Id; return true; }
            var old = queue[0]; queue.RemoveAt(0); r.Lost++; if (r.FirstLost < 0) r.FirstLost = old.Id;
            item.Enq = t; queue.Add(item); return true;
        }
        for (int t = 0; t < 3000; t++)
        {
            foreach (var c in cons)
            {
                if (c.State == "busy" && --c.Rem == 0)
                {
                    if (retry && c.Item.Id % 4 == 3 && !c.Item.Failed) { c.Item.Failed = true; c.State = "putting"; }
                    else { r.Processed++; c.State = "idle"; c.Item = null; }
                }
            }
            foreach (var c in cons) if (c.State == "putting" && Offer(c.Item, t)) { c.State = "idle"; c.Item = null; }
            foreach (var c in cons)
            {
                if (c.State == "idle" && queue.Count > 0)
                {
                    c.Item = queue[0]; queue.RemoveAt(0); c.State = "busy"; c.Rem = Service;
                    if (t - c.Item.Enq > r.MaxWait) r.MaxWait = t - c.Item.Enq;
                }
            }
            for (int k = 0; k < rate && produced < total; k++)
            {
                if (Offer(new Item { Id = produced, Enq = t }, t)) produced++; else { r.Blocked++; break; }
            }
            if (queue.Count > r.Peak) r.Peak = queue.Count;
            r.Tick = t + 1;
            if (produced == total && queue.Count == 0 && cons.All(c => c.State == "idle")) break;
            if (policy == "block" && Full() && cons.All(c => c.State == "putting")) { r.Deadlock = true; break; }
        }
        return r;
    }

    static void Show(string label, Outcome r)
    {
        var head = r.Deadlock ? $"DEADLOCK at tick {r.Tick,-3}" : $"finished at tick {r.Tick,-3}";
        var first = r.FirstLost < 0 ? "-" : r.FirstLost.ToString();
        Console.WriteLine($"{label,-22} {head} processed={r.Processed,-3} lost={r.Lost,-3} first lost={first,-3} high-water={r.Peak,-3} longest wait={r.MaxWait,-3} producer blocked={r.Blocked}");
    }

    public static void Main()
    {
        Console.WriteLine("== producer offers 1 item per tick (the consumers can take 1.5)");
        Show("unbounded", Simulate(1, 0, "block", false));
        Console.WriteLine("== producer offers 2 items per tick, 120 items in all");
        Show("unbounded", Simulate(2, 0, "block", false));
        Show("bound 10, block", Simulate(2, 10, "block", false));
        Show("bound 10, drop newest", Simulate(2, 10, "dropNew", false));
        Show("bound 10, drop oldest", Simulate(2, 10, "dropOld", false));
        Show("bound 1, block", Simulate(2, 1, "block", false));
        Console.WriteLine("== same, but every 4th item fails once and is put back on the same queue");
        Show("unbounded", Simulate(2, 0, "block", true));
        Show("bound 10, block", Simulate(2, 10, "block", true));
        Show("bound 10, drop newest", Simulate(2, 10, "dropNew", true));
    }
}
