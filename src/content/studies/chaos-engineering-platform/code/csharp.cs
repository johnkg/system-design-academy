// A chaos experiment runner, in C#:
// inject a fault into a small slice of a simulated fleet, watch the steady-state metric every tick,
// refuse experiments above the blast-radius limit, and abort and roll back when a guardrail is breached.
using System;
using System.Collections.Generic;
using System.Linq;

public record Experiment(string Name, string Kind, int Targets, int Value, int Limit);
public record Result(string Status, int MaxPm, int AbortedAt, bool Restored);

public static class Program
{
    const int N = 10, Requests = 100, Capacity = 15, Ticks = 20, Start = 5; // 10 instances, 100 requests per tick
    const int Steady = 50, Guard = 100, Detect = 2;                          // error rates in requests per thousand
    const int PerMille = 1000;

    // 32-bit LCG (Numerical Recipes constants)
    static long seed = 7;
    static int Random(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)(seed / 65536 % n); }

    static Result Run(Experiment exp)
    {
        if (exp.Targets > exp.Limit) return new Result("rejected", 0, -1, true);
        var dead = new bool[N]; var ejectAt = new int[N]; var errPct = new int[N]; var cap = Enumerable.Repeat(Capacity, N).ToArray();
        int cursor = 0, maxPm = 0; bool violated = false;
        for (int t = 0; t < Ticks; t++)
        {
            if (t == Start)
                for (int i = 0; i < exp.Targets; i++)
                {
                    if (exp.Kind == "kill") { dead[i] = true; ejectAt[i] = t + Detect; }
                    else if (exp.Kind == "errors") errPct[i] = exp.Value;
                    else cap[i] = exp.Value; // slow: the instance can serve only a few requests per tick
                }
            int tick = t;
            var rotation = Enumerable.Range(0, N).Where(i => !(dead[i] && tick >= ejectAt[i])).ToArray(); // the load balancer drops dead instances after a delay
            var load = new int[N];
            bool Attempt(int i)
            {
                if (dead[i] || load[i] >= cap[i]) return false;
                load[i]++;
                return !(errPct[i] > 0 && Random(100) < errPct[i]);
            }
            int errors = 0;
            for (int r = 0; r < Requests; r++)
            {
                bool ok = Attempt(rotation[cursor++ % rotation.Length]);
                if (!ok) ok = Attempt(rotation[cursor++ % rotation.Length]); // the client retries once
                if (!ok) errors++;
            }
            int pm = errors * PerMille / Requests;
            if (t >= Start)
            {
                maxPm = Math.Max(maxPm, pm);
                if (pm > Steady) violated = true;
                if (pm > Guard) // guardrail breached: stop injecting and restore everything
                {
                    Array.Fill(dead, false); Array.Fill(errPct, 0); Array.Fill(cap, Capacity);
                    return new Result("aborted", maxPm, t, dead.All(d => !d) && errPct.All(e => e == 0) && cap.All(c => c == Capacity));
                }
            }
        }
        return new Result(violated ? "hypothesis disproved" : "hypothesis held", maxPm, -1, true);
    }

    public static int Main()
    {
        var experiments = new[]
        {
            new Experiment("errors on 2 instances", "errors", 2, 30, 3),
            new Experiment("slow 3 instances", "slow", 3, 5, 3),
            new Experiment("kill 5 instances", "kill", 5, 0, 5),
            new Experiment("kill 8 instances", "kill", 8, 0, 3),
        };
        var results = experiments.Select(e => (e, r: Run(e))).ToList();
        foreach (var (e, r) in results)
            Console.WriteLine($"{e.Name}: {r.Status}, worst {r.MaxPm} per thousand{(r.AbortedAt >= 0 ? $", aborted at tick {r.AbortedAt}" : "")}");
        var by = results.ToDictionary(x => x.e.Kind + x.e.Targets, x => x.r);
        bool ok = by["errors2"].Status == "hypothesis held" && by["kill8"].Status == "rejected" && by["kill5"].Status == "aborted" && results.All(x => x.r.Restored);
        Console.WriteLine($"blast radius enforced, guardrail aborted the kill, fleet restored: {ok.ToString().ToLowerInvariant()}");
        return ok ? 0 : 1;
    }
}
