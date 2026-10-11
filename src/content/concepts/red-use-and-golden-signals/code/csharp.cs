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

    static Func<int> Lcg(uint seed)
    {
        uint s = seed;
        return () => { s = unchecked(s * 1664525u + 1013904223u); return (int)(s >> 8); }; // 24 bits
    }

    // One period of 400 checkout requests plus 12 resource samples, with an optional injected fault.
    static Period Simulate(string fault, uint seed)
    {
        var r = Lcg(seed);
        var events = new List<Ev>();
        for (int i = 0; i < 400; i++)
        {
            int own = 10 + r() % 20;
            int pay = 40 + r() % 40, inv = 15 + r() % 15, db = 4 + r() % 8, pool = 0;
            bool ok = true;
            if (fault == "payments_slow") pay *= 12;
            if (fault == "db_lock") db += 600 + r() % 400;
            if (fault == "pool_exhaustion") pool = 500 + r() % 500; // waiting for a connection, not a slow query
            if (fault == "bad_deploy" && r() % 100 < 25) { ok = false; inv = 5 + r() % 8; }
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
        for (int i = 0; i < 12; i++)
        {
            int poolUtil = 30 + r() % 15, waiters = 0, cpu = 25 + r() % 10;
            if (fault == "pool_exhaustion") { poolUtil = 100; waiters = 20 + r() % 10; cpu = 15 + r() % 5; } // starved database idles
            if (fault == "db_lock") { poolUtil = 100; waiters = 10 + r() % 10; cpu = 5 + r() % 5; }
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
            if (RedOf(faulty, d).ErrPm - RedOf(healthy, d).ErrPm >= 50 && RedOf(faulty, d).FailP50 < RedOf(healthy, d).P99) return d;
        foreach (var d in Deps)
            if (RedOf(faulty, d).P99 >= 3 * RedOf(healthy, d).P99) return d; // a dependency is slow in its own right
        if (RedOf(faulty, "checkout").P99 >= 3 * RedOf(healthy, "checkout").P99) return u.Waiters >= 10 ? "checkout db pool" : "checkout";
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
        var healthy = Simulate("none", 7);
        Row("healthy", healthy);
        string idle = Diagnose(healthy, Simulate("none", 8));
        Console.WriteLine($"healthy diagnosis: {idle}");
        int correct = 0;
        int hAvg = RedOf(healthy, "checkout").Avg;
        foreach (var (fault, culprit) in faults)
        {
            var faulty = Simulate(fault, 7);
            Row(fault, faulty);
            string got = Diagnose(healthy, faulty);
            bool avgFlags = RedOf(faulty, "checkout").Avg >= 2 * hAvg; // what an average-only dashboard could say
            Console.WriteLine($"  -> blame {got} (expected {culprit}); average-only alarm: {(avgFlags ? "true" : "false")}");
            if (got == culprit) correct++;
        }
        Console.WriteLine($"classified {correct} of 4 faults correctly");
        if (correct != 4 || idle != "none") return 1;
        if (RedOf(Simulate("bad_deploy", 7), "checkout").Avg >= hAvg) return 1; // the average even improves
        return 0;
    }
}
