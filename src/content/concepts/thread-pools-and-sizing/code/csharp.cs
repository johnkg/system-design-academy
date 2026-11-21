// Thread pool: a tick simulation (no real threads, no clock) of jobs waiting in a queue for a fixed set of worker threads.
// The machine has 4 cores. A thread that waits for I/O keeps its place in the pool but uses no core. When more threads
// want a core than there are cores, the cores are shared round-robin. Model assumption: a tick is one unit of work;
// switching between threads costs nothing here, although real thread switching and memory per thread do cost something.
// Look for: IO jobs need about 12 threads (arrival rate x time in system); more than that gains nothing; CPU jobs gain
// nothing beyond 4 threads; fan-out jobs that wait for a sub-job in the SAME pool deadlock when the pool is small.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const int Cores = 4;

    class Job { public bool IsChild; public int Arrive, Parent; }
    class Thread { public string State = "free"; public int Rem, Last = -1, Phase; public Job Job; }
    class Outcome { public int Done, Rejected, Ticks, PeakQueue, PeakThreads, Mean, PerHundred; public bool Deadlock; }

    static (int jobs, int gap) Workload(string name) => name switch
    {
        "cpu" => (60, 1),    // 8 ticks of CPU each, one job per tick
        "io" => (60, 1),     // 2 ticks of CPU, then 10 ticks waiting for I/O
        _ => (30, 1),        // fanout: 1 tick CPU, submit a 3-tick child to the same pool and wait for it, then 1 tick CPU
    };

    static Outcome Simulate(string workload, int pool, int qbound)
    {
        var (jobs, gap) = Workload(workload);
        var queue = new List<Job>();
        var th = new Thread[pool];
        for (int i = 0; i < pool; i++) th[i] = new Thread();
        int next = 0, rejected = 0, done = 0, peakQueue = 0, peakThreads = 0, ticks = 0;
        long sum = 0;
        bool deadlock = false;
        void Complete(Thread x, int t)
        {
            if (!x.Job.IsChild) { done++; sum += t + 1 - x.Job.Arrive; }
            else { var p = th[x.Job.Parent]; p.State = "cpu"; p.Rem = 1; p.Phase = 2; }
            x.State = "free"; x.Job = null;
        }
        for (int t = 0; t < 5000; t++)
        {
            if (next < jobs && t % gap == 0)
            {
                if (qbound > 0 && queue.Count >= qbound) rejected++; else queue.Add(new Job { Arrive = t });
                next++;
            }
            foreach (var x in th)
            {
                if (x.State == "free" && queue.Count > 0)
                {
                    x.Job = queue[0]; queue.RemoveAt(0); x.Phase = 1; x.State = "cpu";
                    x.Rem = workload == "cpu" ? 8 : workload == "io" ? 2 : x.Job.IsChild ? 3 : 1;
                }
            }
            if (queue.Count > peakQueue) peakQueue = queue.Count;
            int busy = th.Count(x => x.State != "free");
            if (busy > peakThreads) peakThreads = busy;
            var running = Enumerable.Range(0, pool).Where(i => th[i].State == "cpu").OrderBy(i => th[i].Last).ThenBy(i => i).Take(Cores).ToList();
            foreach (var i in running) { th[i].Rem--; th[i].Last = t; }
            for (int i = 0; i < pool; i++) if (th[i].State == "io") th[i].Rem--;
            for (int i = 0; i < pool; i++)
            {
                var x = th[i];
                if (x.Rem != 0) continue;
                if (x.State == "cpu")
                {
                    if (workload == "io" && x.Phase == 1) { x.Phase = 2; x.State = "io"; x.Rem = 10; }
                    else if (workload == "fanout" && !x.Job.IsChild && x.Phase == 1) { queue.Add(new Job { IsChild = true, Parent = i }); x.State = "blocked"; x.Rem = -1; }
                    else Complete(x, t);
                }
                else if (x.State == "io") Complete(x, t);
            }
            ticks = t + 1;
            if (done == jobs - rejected && next == jobs) break;
            if (th.All(x => x.State == "blocked")) { deadlock = true; break; }
        }
        return new Outcome { Done = done, Rejected = rejected, Ticks = ticks, PeakQueue = peakQueue, PeakThreads = peakThreads, Mean = done > 0 ? (int)(sum / done) : 0, PerHundred = done * 100 / ticks, Deadlock = deadlock };
    }

    public static void Main()
    {
        var plan = new (string, int[])[] { ("cpu", new[] { 2, 4, 8, 64 }), ("io", new[] { 4, 8, 12, 16, 64 }), ("fanout", new[] { 2, 4, 8, 12, 16 }) };
        foreach (var (workload, pools) in plan)
        {
            var (jobs, gap) = Workload(workload);
            Console.WriteLine($"== {workload}: {jobs} jobs, one every {gap} tick(s), unbounded queue");
            foreach (var pool in pools)
            {
                var r = Simulate(workload, pool, 0);
                var head = r.Deadlock ? $"DEADLOCK at tick {r.Ticks}, {r.Done} done" : $"ticks={r.Ticks,-5} done={r.Done}";
                Console.WriteLine($"pool={pool,-3} {head} per100={r.PerHundred,-4} mean latency={r.Mean,-4} peak queue={r.PeakQueue,-3} peak threads={r.PeakThreads}");
            }
        }
        Console.WriteLine("== io, pool 8: bounded queue of 10 rejects, unbounded keeps everything");
        foreach (var q in new[] { 0, 10 })
        {
            var r = Simulate("io", 8, q);
            Console.WriteLine($"queue bound={(q == 0 ? "none" : q.ToString()),-5} done={r.Done,-3} rejected={r.Rejected,-3} mean latency={r.Mean,-4} peak queue={r.PeakQueue}");
        }
    }
}
