// Locks: a deterministic scheduler (no real threads, no clock) for two questions.
// Part 1 walks EVERY interleaving of threads that take locks in some order and counts the schedules that end in deadlock.
// Part 2 is a tick model of contention: threads alternate work outside a lock and a critical section behind a lock.
// Look for: opposite lock order deadlocks in some schedules, the same order never does; one coarse lock is safe
// but, once the lock is busy all the time, more threads stop helping.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const string Names = "ABCG";

    // "L0" take lock 0 (A), "U0" release it, "W" do the work. The locks are not re-entrant: taking a lock you hold blocks you.
    static readonly Dictionary<string, string[][]> Scenarios = new()
    {
        ["opposite"] = new[] { new[] { "L0", "L1", "W", "U1", "U0" }, new[] { "L1", "L0", "W", "U0", "U1" } },
        ["ordered"] = new[] { new[] { "L0", "L1", "W", "U1", "U0" }, new[] { "L0", "L1", "W", "U1", "U0" } },
        ["ring"] = new[] { new[] { "L0", "L1", "W", "U1", "U0" }, new[] { "L1", "L2", "W", "U2", "U1" }, new[] { "L2", "L0", "W", "U0", "U2" } },
        ["ringOrdered"] = new[] { new[] { "L0", "L1", "W", "U1", "U0" }, new[] { "L1", "L2", "W", "U2", "U1" }, new[] { "L0", "L2", "W", "U2", "U0" } },
        ["reentry"] = new[] { new[] { "L0", "L0", "W", "U0", "U0" }, new[] { "L0", "L0", "W", "U0", "U0" } },
        ["coarse"] = new[] { new[] { "L3", "W", "U3" }, new[] { "L3", "W", "U3" } },
    };

    class Outcome { public int Complete, Deadlocked; public string Example = "-", Stuck = "-"; }

    static Outcome Explore(string[][] progs)
    {
        int n = progs.Length;
        var r = new Outcome();
        var trail = new List<int>();
        bool CanRun(int[] owner, int[] pc, int i)
        {
            if (pc[i] >= progs[i].Length) return false;
            var op = progs[i][pc[i]];
            return !(op[0] == 'L' && owner[int.Parse(op.Substring(1))] != -1);
        }
        void Walk(int[] owner, int[] pc)
        {
            var ready = new List<int>();
            for (int i = 0; i < n; i++) if (CanRun(owner, pc, i)) ready.Add(i);
            if (ready.Count == 0)
            {
                var unfinished = new List<int>();
                for (int i = 0; i < n; i++) if (pc[i] < progs[i].Length) unfinished.Add(i);
                if (unfinished.Count == 0) { r.Complete++; return; }
                r.Deadlocked++;
                if (r.Example == "-")
                {
                    r.Example = string.Concat(trail);
                    var parts = new List<string>();
                    foreach (var i in unfinished)
                    {
                        var holds = new List<char>();
                        for (int l = 0; l < 4; l++) if (owner[l] == i) holds.Add(Names[l]);
                        char wants = Names[int.Parse(progs[i][pc[i]].Substring(1))];
                        parts.Add($"T{i} holds {(holds.Count > 0 ? string.Concat(holds) : "nothing")} wants {wants}");
                    }
                    r.Stuck = string.Join(" | ", parts);
                }
                return;
            }
            foreach (var i in ready)
            {
                var o = (int[])owner.Clone();
                var p = (int[])pc.Clone();
                var op = progs[i][p[i]];
                p[i]++;
                if (op[0] == 'L') o[int.Parse(op.Substring(1))] = i;
                if (op[0] == 'U') o[int.Parse(op.Substring(1))] = -1;
                trail.Add(i); Walk(o, p); trail.RemoveAt(trail.Count - 1);
            }
        }
        Walk(new[] { -1, -1, -1, -1 }, new int[n]);
        return r;
    }

    // Part 2. Each thread does `jobs` jobs: `outside` ticks of work that needs no lock, then `hold` ticks inside one lock chosen
    // from `locks` of them (job number + thread number, modulo the lock count). A busy lock is queued in arrival order.
    static (int ticks, int waiting, int longest, int alone) Contention(int threads, int locks, int hold, int outside, int jobs)
    {
        var phase = new string[threads];
        var rem = new int[threads];
        var job = new int[threads];
        for (int i = 0; i < threads; i++) { phase[i] = "out"; rem[i] = outside; }
        var owner = new int[locks];
        Array.Fill(owner, -1);
        var queue = new List<int>[locks];
        for (int l = 0; l < locks; l++) queue[l] = new List<int>();
        int finished = 0, t = 0, waiting = 0, longest = 0;
        while (finished < threads)
        {
            for (int i = 0; i < threads; i++)
            {
                if (phase[i] == "out")
                {
                    if (--rem[i] == 0) { phase[i] = "wait"; queue[(i + job[i]) % locks].Add(i); }
                }
                else if (phase[i] == "hold")
                {
                    if (--rem[i] == 0)
                    {
                        owner[(i + job[i]) % locks] = -1; job[i]++;
                        if (job[i] == jobs) { phase[i] = "done"; finished++; } else { phase[i] = "out"; rem[i] = outside; }
                    }
                }
            }
            for (int l = 0; l < locks; l++)
                if (owner[l] == -1 && queue[l].Count > 0) { int i = queue[l][0]; queue[l].RemoveAt(0); owner[l] = i; phase[i] = "hold"; rem[i] = hold; }
            for (int l = 0; l < locks; l++) { waiting += queue[l].Count; if (queue[l].Count > longest) longest = queue[l].Count; }
            t++;
        }
        return (t, waiting, longest, threads * jobs * (outside + hold));
    }

    public static void Main()
    {
        Console.WriteLine("== lock order: every interleaving");
        foreach (var name in new[] { "opposite", "ordered", "ring", "ringOrdered", "reentry", "coarse" })
        {
            var r = Explore(Scenarios[name]);
            Console.WriteLine($"{name,-12} threads={Scenarios[name].Length} schedules={r.Complete + r.Deadlocked,-5} deadlocked={r.Deadlocked,-5} first={r.Example} stuck: {r.Stuck}");
        }
        Console.WriteLine("== contention: 20 jobs per thread, 20 ticks of work outside the lock");
        foreach (var hold in new[] { 2, 20 })
            foreach (var locks in new[] { 1, 4 })
                foreach (var threads in new[] { 1, 2, 4, 8, 16 })
                {
                    var c = Contention(threads, locks, hold, 20, 20);
                    int waitPct = c.waiting * 100 / (threads * c.ticks);
                    Console.WriteLine($"hold={hold,-3} locks={locks} threads={threads,-3} ticks={c.ticks,-6} speedup_x10={c.alone * 10 / c.ticks,-4} waiting%={waitPct,-3} longest queue={c.longest}");
                }
    }
}
