// Race conditions: a tiny deterministic scheduler runs EVERY interleaving of the threads' steps (no real threads, no clock).
// A step is one indivisible action; between two steps any other runnable thread may go first.
// Look for: the unsafe counter loses updates in most schedules; locking each step separately looks safe but is not;
// a lock, an atomic add and a compare-and-swap loop are correct in every schedule.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const int Limit = 80;

    class State
    {
        public int Shared, Owner;
        public int[] Pc, Tmp;
        public State Copy() => new State { Shared = Shared, Owner = Owner, Pc = (int[])Pc.Clone(), Tmp = (int[])Tmp.Clone() };
    }

    class Result { public int Total, Wrong, Deadlocks, Lowest = 1000000; public string Example = "-"; }

    // R read into a private copy, W write copy+1, A atomic add, L lock, U unlock, C compare-and-swap then retry on failure,
    // K check the private copy (stop if too small), S subtract, D atomic check-and-subtract, X compare-and-swap subtract.
    static string[] One(string scenario, string variant) => (scenario, variant) switch
    {
        ("counter", "unsafe") => new[] { "R", "W" },
        ("counter", "lock") => new[] { "L", "R", "W", "U" },
        ("counter", "lockEach") => new[] { "L", "R", "U", "L", "W", "U" },
        ("counter", "atomic") => new[] { "A" },
        ("counter", "cas") => new[] { "R", "C" },
        ("withdraw", "unsafe") => new[] { "R", "K", "S" },
        ("withdraw", "lock") => new[] { "L", "R", "K", "S", "U" },
        ("withdraw", "lockEach") => new[] { "L", "R", "U", "K", "L", "S", "U" },
        ("withdraw", "atomic") => new[] { "D" },
        _ => new[] { "R", "K", "X" },
    };

    static string[] ProgramOf(string scenario, string variant, int iters)
    {
        var ops = new List<string>();
        for (int i = 0; i < iters; i++) ops.AddRange(One(scenario, variant));
        return ops.ToArray();
    }

    static bool Runnable(State st, string[] prog, int i)
    {
        if (st.Pc[i] >= prog.Length) return false;
        return !(prog[st.Pc[i]] == "L" && st.Owner != -1);
    }

    // Executes one step of thread i and returns the new state (the old one is left alone).
    static State Step(State st, string[] prog, int i)
    {
        var s = st.Copy();
        var op = prog[s.Pc[i]];
        s.Pc[i]++;
        switch (op)
        {
            case "R": s.Tmp[i] = s.Shared; break;
            case "W": s.Shared = s.Tmp[i] + 1; break;
            case "A": s.Shared += 1; break;
            case "S": s.Shared -= Limit; break;
            case "D": if (s.Shared >= Limit) s.Shared -= Limit; break;
            case "L": s.Owner = i; break;
            case "U": s.Owner = -1; break;
            case "K":
                if (s.Tmp[i] < Limit) { if (s.Owner == i) s.Owner = -1; s.Pc[i] = prog.Length; }
                break;
            case "C":
                if (s.Shared == s.Tmp[i]) s.Shared = s.Tmp[i] + 1; else s.Pc[i] -= 2;
                break;
            case "X":
                if (s.Shared == s.Tmp[i]) s.Shared -= Limit; else s.Pc[i] -= 3;
                break;
        }
        return s;
    }

    // Depth-first walk over every schedule. Returns how many there were and how many ended with a wrong value.
    static Result Explore(string scenario, string variant, int threads, int iters)
    {
        var prog = ProgramOf(scenario, variant, iters);
        int expected = scenario == "counter" ? threads * iters : 20;
        var start = new State { Shared = scenario == "counter" ? 0 : 100, Owner = -1, Pc = new int[threads], Tmp = new int[threads] };
        var r = new Result();
        var trail = new List<int>();
        void Walk(State st)
        {
            var ready = new List<int>();
            for (int i = 0; i < threads; i++) if (Runnable(st, prog, i)) ready.Add(i);
            if (ready.Count == 0)
            {
                bool done = true;
                for (int i = 0; i < threads; i++) if (st.Pc[i] < prog.Length) done = false;
                if (!done) { r.Deadlocks++; return; }
                r.Total++;
                if (st.Shared < r.Lowest) r.Lowest = st.Shared;
                if (st.Shared != expected) { r.Wrong++; if (r.Example == "-") r.Example = string.Concat(trail); }
                return;
            }
            foreach (var i in ready) { trail.Add(i); Walk(Step(st, prog, i)); trail.RemoveAt(trail.Count - 1); }
        }
        Walk(start);
        return r;
    }

    public static void Main()
    {
        var cases = new (string, int, int)[] { ("counter", 2, 1), ("counter", 2, 2), ("counter", 3, 1), ("withdraw", 2, 1) };
        foreach (var (scenario, threads, iters) in cases)
        {
            var what = scenario == "counter" ? $"{threads} threads x {iters} increments, expected {threads * iters}" : $"{threads} threads each withdraw 80 from 100, expected 20 left";
            Console.WriteLine($"== {scenario}: {what}");
            foreach (var variant in new[] { "unsafe", "lock", "lockEach", "atomic", "cas" })
            {
                var r = Explore(scenario, variant, threads, iters);
                Console.WriteLine($"{variant,-9} interleavings={r.Total,-6} wrong={r.Wrong,-6} lowest={r.Lowest,-5} first bad schedule={r.Example}");
            }
        }
    }
}
