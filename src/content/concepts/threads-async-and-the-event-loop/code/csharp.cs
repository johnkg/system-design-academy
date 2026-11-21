// Event loop: one thread, many tasks, simulated in ticks (no real timers, no clock).
// Part 1: handlers that read a shared counter, await some I/O, then write it back. One thread, yet updates are lost,
//         because other tasks run while a handler waits at an await.
// Part 2: 8 requests each wait 5 ticks for I/O and then need CPU time. A "ping" arrives at tick 6. How long do the
//         requests and the ping take when I/O blocks the loop, when it is awaited, when the CPU work is cut into slices,
//         and when it is moved to 2 worker threads?
// Look for: the lost update needs the await between read and write; a long CPU task delays everything queued behind it.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const int IO = 5;

    // R read the counter into a local copy, A await I/O (the task leaves the loop for IO ticks), W write copy+1,
    // L take an async mutex (wait in line if it is held), U release it and wake the next waiter.
    static string[] Handler(string variant) => variant switch
    {
        "gap" => new[] { "R", "A", "W" },
        "tight" => new[] { "A", "R", "W" },
        _ => new[] { "L", "R", "A", "W", "U" },
    };

    class Timer { public int At, Seq, Task; }

    static (int counter, int ticks) Handlers(string variant, int n)
    {
        var prog = Handler(variant);
        var pc = new int[n];
        var tmp = new int[n];
        var ready = new List<int>();
        for (int i = 0; i < n; i++) ready.Add(i);
        var timers = new List<Timer>();
        var waiting = new List<int>();
        int counter = 0, now = 0, seq = 0, owner = -1;
        while (ready.Count > 0 || timers.Count > 0)
        {
            if (ready.Count == 0)
            {
                now = timers.Min(x => x.At);
                var due = timers.Where(x => x.At <= now).OrderBy(x => x.At).ThenBy(x => x.Seq).ToList();
                foreach (var d in due) { ready.Add(d.Task); timers.Remove(d); }
            }
            int i = ready[0];
            ready.RemoveAt(0);
            bool running = true;
            while (running && pc[i] < prog.Length)
            {
                var op = prog[pc[i]];
                if (op == "R") { tmp[i] = counter; pc[i]++; }
                else if (op == "W") { counter = tmp[i] + 1; pc[i]++; }
                else if (op == "A") { timers.Add(new Timer { At = now + IO, Seq = seq++, Task = i }); pc[i]++; running = false; }
                else if (op == "L") { if (owner == -1) { owner = i; pc[i]++; } else { waiting.Add(i); pc[i]++; running = false; } }
                else if (op == "U")
                {
                    owner = -1; pc[i]++;
                    if (waiting.Count > 0) { owner = waiting[0]; waiting.RemoveAt(0); ready.Add(owner); }
                }
            }
        }
        return (counter, now);
    }

    class Item { public int Id, Rem; }
    class Running { public Item Item = new Item(); public int Len, End; }
    class Worker { public int Id, End; }

    // Part 2. The loop runs one item at a time and an item is never interrupted unless it is cut into slices.
    // blocking: the loop waits for each request's I/O itself. await: I/O overlaps, CPU runs on the loop in arrival order.
    // chunked: like await, but CPU runs `slice` ticks at a time and the rest goes to the back of the queue.
    // workers: CPU runs on `W` worker threads (one per core) and the loop stays free.
    static (int total, int mean, int ping, int busyPct) LoopSim(string variant, int R, int io, int cpu, int slice, int W, int pingAt)
    {
        var loopQ = new List<Item>();
        var workQ = new List<Item>();
        Running cur = null;
        int busy = 0, remaining = R + 1, pingDone = -1, total = 0, sum = 0;
        var workers = new Worker[W];
        void Finish(int id, int t)
        {
            remaining--;
            if (id < 0) pingDone = t; else { sum += t; if (t > total) total = t; }
        }
        for (int t = 0; remaining > 0; t++)
        {
            if (variant == "blocking") { if (t == 0) for (int r = 0; r < R; r++) loopQ.Add(new Item { Id = r, Rem = io + cpu }); }
            else if (t == io) for (int r = 0; r < R; r++) (variant == "workers" ? workQ : loopQ).Add(new Item { Id = r, Rem = cpu });
            if (t == pingAt) loopQ.Add(new Item { Id = -1, Rem = 1 });
            if (cur != null && cur.End == t)
            {
                cur.Item.Rem -= cur.Len;
                if (cur.Item.Rem > 0) loopQ.Add(cur.Item); else Finish(cur.Item.Id, t);
                cur = null;
            }
            for (int w = 0; w < W; w++) if (workers[w] != null && workers[w].End == t) { Finish(workers[w].Id, t); workers[w] = null; }
            if (cur == null && loopQ.Count > 0)
            {
                var item = loopQ[0];
                loopQ.RemoveAt(0);
                int len = variant == "chunked" && item.Id >= 0 ? Math.Min(item.Rem, slice) : item.Rem;
                cur = new Running { Item = item, Len = len, End = t + len };
            }
            for (int w = 0; w < W; w++)
                if (workers[w] == null && workQ.Count > 0) { var item = workQ[0]; workQ.RemoveAt(0); workers[w] = new Worker { Id = item.Id, End = t + item.Rem }; }
            if (cur != null) busy++;
            if (remaining == 0) total = Math.Max(total, pingDone);
        }
        return (total, sum / R, pingDone - pingAt, busy * 100 / total);
    }

    public static void Main()
    {
        Console.WriteLine("== shared counter, one thread, each handler awaits 5 ticks of I/O");
        foreach (var n in new[] { 2, 4 })
            foreach (var v in new[] { "gap", "tight", "mutex" })
            {
                var r = Handlers(v, n);
                Console.WriteLine($"handlers={n} {v,-6} final={r.counter} expected={n} ticks={r.ticks}");
            }
        Console.WriteLine("== 8 requests, 5 ticks of I/O each, then CPU; ping at tick 6; slice 5, 2 workers");
        foreach (var cpu in new[] { 2, 40 })
            foreach (var v in new[] { "blocking", "await", "chunked", "workers" })
            {
                var r = LoopSim(v, 8, IO, cpu, 5, 2, 6);
                Console.WriteLine($"cpu={cpu,-3} {v,-9} total={r.total,-4} mean={r.mean,-4} ping={r.ping,-4} loop busy%={r.busyPct}");
            }
    }
}
