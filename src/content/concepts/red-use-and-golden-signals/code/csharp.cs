// RED and USE summaries from a seeded event stream, and a rule that names the failing component.
// Integers only, so C#, Python and JavaScript print exactly the same text.
using System;
using System.Collections.Generic;
using System.Linq;

record Ev(string Svc, int Dur, bool Ok);
record Sample(int PoolUtil, int Waiters, int Cpu);
record Period(List<Ev> Events, List<Sample> Samples);
record Red(int Rate, int ErrPm, int P99, int FailP50, int Avg);
record Use(int PoolUtil, int Waiters, int DbCpu);

public static class Program
{
    static readonly string[] Deps = { "payments", "inventory", "db" };

    const int Requests = 400; // checkout requests per period
    const int Samples = 12; // resource samples per period
    const int PaySlowdown = 12; // payments_slow multiplies payment latency
    const int BadDeployFailPct = 25;
    const int ErrJumpPm = 50; // diagnosis: an error-rate jump (per mille) that marks a bad build
    const int SlowFactor = 3; // p99 this many times the healthy p99 is slow
    const int PoolWaitersAlert = 10; // mean pool waiters that blame the pool
    const int Seed = 7;
    const int ControlSeed = 8; // a second healthy period
    // Draws as (minimum, spread): a value is minimum + (random % spread).
    static readonly (int Min, int Spread) OwnMs = (10, 20); // checkout's own work
    static readonly (int Min, int Spread) PayMs = (40, 40);
    static readonly (int Min, int Spread) InvMs = (15, 15);
    static readonly (int Min, int Spread) DbMs = (4, 8);
    static readonly (int Min, int Spread) LockWaitMs = (600, 400); // db_lock: extra time per query
    static readonly (int Min, int Spread) PoolWaitMs = (500, 500); // pool_exhaustion: waiting for a connection
    static readonly (int Min, int Spread) FastFailMs = (5, 8); // bad_deploy: a failed inventory call
    static readonly (int Min, int Spread) PoolUtilPct = (30, 15); // resource samples
    static readonly (int Min, int Spread) DbCpuPct = (25, 10);
    static readonly (int Min, int Spread) ExhaustedWaiters = (20, 10);
    static readonly (int Min, int Spread) ExhaustedCpuPct = (15, 5);
    static readonly (int Min, int Spread) LockedWaiters = (10, 10);
    static readonly (int Min, int Spread) LockedCpuPct = (5, 5);

    static Func<int> Lcg(uint seed)
    {
        uint s = seed;
        return () => { s = unchecked(s * 1664525u + 1013904223u); return (int)(s >> 8); }; // 24 bits
    }

    // One period of 400 checkout requests plus 12 resource samples, with an optional injected fault.
    static Period Simulate(string fault, uint seed)
    {
        var r = Lcg(seed);
        int Draw((int Min, int Spread) d) => d.Min + r() % d.Spread;
        var events = new List<Ev>();
        for (int i = 0; i < Requests; i++)
        {
            int own = Draw(OwnMs);
            int pay = Draw(PayMs), inv = Draw(InvMs), db = Draw(DbMs), pool = 0;
            bool ok = true;
            if (fault == "payments_slow") pay *= PaySlowdown;
            if (fault == "db_lock") db += Draw(LockWaitMs);
            if (fault == "pool_exhaustion") pool = Draw(PoolWaitMs); // waiting for a connection, not a slow query
            if (fault == "bad_deploy" && r() % 100 < BadDeployFailPct) { ok = false; inv = Draw(FastFailMs); }
            if (ok)
            {
                events.Add(new Ev("payments", pay, true)); events.Add(new Ev("db", db, true));
                events.Add(new Ev("inventory", inv, true)); events.Add(new Ev("checkout", own + pool + pay + inv + db, true));
            }
            else // the bad inventory build fails fast and checkout returns 500 straight away
            {
                events.Add(new Ev("inventory", inv, false)); events.Add(new Ev("checkout", own + inv, false));
            }
        }
        var samples = new List<Sample>();
        for (int i = 0; i < Samples; i++)
        {
            int poolUtil = Draw(PoolUtilPct), waiters = 0, cpu = Draw(DbCpuPct);
            if (fault == "pool_exhaustion") { poolUtil = 100; waiters = Draw(ExhaustedWaiters); cpu = Draw(ExhaustedCpuPct); } // starved database idles
            if (fault == "db_lock") { poolUtil = 100; waiters = Draw(LockedWaiters); cpu = Draw(LockedCpuPct); }
            samples.Add(new Sample(poolUtil, waiters, cpu));
        }
        return new Period(events, samples);
    }

    static int Percentile(List<int> sorted, int p) => sorted[(p * sorted.Count + 99) / 100 - 1]; // nearest rank
    static int Mean(IEnumerable<int> xs) { var l = xs.ToList(); return l.Count == 0 ? 0 : l.Sum() / l.Count; }

    // RED per service: Rate (calls), Errors (per mille), Duration (p99 of successes, p50 of failures kept apart).
    static Red RedOf(Period p, string svc)
    {
        var mine = p.Events.Where(e => e.Svc == svc).ToList();
        var ok = mine.Where(e => e.Ok).Select(e => e.Dur).OrderBy(x => x).ToList();
        var bad = mine.Where(e => !e.Ok).Select(e => e.Dur).OrderBy(x => x).ToList();
        return new Red(mine.Count, bad.Count * 1000 / mine.Count, ok.Count > 0 ? Percentile(ok, 99) : 0,
            bad.Count > 0 ? Percentile(bad, 50) : 0, Mean(mine.Select(e => e.Dur)));
    }
    // USE for the connection pool and the database host.
    static Use UseOf(Period p) => new Use(Mean(p.Samples.Select(s => s.PoolUtil)), Mean(p.Samples.Select(s => s.Waiters)), Mean(p.Samples.Select(s => s.Cpu)));

    // The rule: start at the symptom, walk down to the deepest component that is itself abnormal.
    static string Diagnose(Period healthy, Period faulty)
    {
        var u = UseOf(faulty);
        foreach (var d in Deps) // fast failures: a bad build, not a slow dependency
            if (RedOf(faulty, d).ErrPm - RedOf(healthy, d).ErrPm >= ErrJumpPm && RedOf(faulty, d).FailP50 < RedOf(healthy, d).P99) return d;
        foreach (var d in Deps)
            if (RedOf(faulty, d).P99 >= SlowFactor * RedOf(healthy, d).P99) return d; // a dependency is slow in its own right
        if (RedOf(faulty, "checkout").P99 >= SlowFactor * RedOf(healthy, "checkout").P99) return u.Waiters >= PoolWaitersAlert ? "checkout db pool" : "checkout";
        return "none";
    }

    static void Row(string name, Period p)
    {
        var c = RedOf(p, "checkout"); var pay = RedOf(p, "payments"); var inv = RedOf(p, "inventory"); var db = RedOf(p, "db"); var u = UseOf(p);
        Console.WriteLine($"{name.PadRight(16)} checkout avg={c.Avg} p99={c.P99} err_pm={c.ErrPm} fail_p50={c.FailP50} | pay p99={pay.P99} | inv err_pm={inv.ErrPm} | db p99={db.P99} | pool util={u.PoolUtil} wait={u.Waiters} dbcpu={u.DbCpu}");
    }

    public static int Main()
    {
        var faults = new (string Fault, string Culprit)[] { ("payments_slow", "payments"), ("db_lock", "db"), ("pool_exhaustion", "checkout db pool"), ("bad_deploy", "inventory") };
        var healthy = Simulate("none", Seed);
        Row("healthy", healthy);
        string idle = Diagnose(healthy, Simulate("none", ControlSeed));
        Console.WriteLine($"healthy diagnosis: {idle}");
        int correct = 0;
        int hAvg = RedOf(healthy, "checkout").Avg;
        foreach (var (fault, culprit) in faults)
        {
            var faulty = Simulate(fault, Seed);
            Row(fault, faulty);
            string got = Diagnose(healthy, faulty);
            bool avgFlags = RedOf(faulty, "checkout").Avg >= 2 * hAvg; // what an average-only dashboard could say
            Console.WriteLine($"  -> blame {got} (expected {culprit}); average-only alarm: {(avgFlags ? "true" : "false")}");
            if (got == culprit) correct++;
        }
        Console.WriteLine($"classified {correct} of 4 faults correctly");
        if (correct != faults.Length || idle != "none") return 1;
        if (RedOf(Simulate("bad_deploy", Seed), "checkout").Avg >= hAvg) return 1; // the average even improves
        return 0;
    }
}
