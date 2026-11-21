// A job service for 4 tenants, second by second for 500 seconds. Tenant 0 is the noisy one: it submits a burst of 12
// jobs a second between 100 s and 200 s. The three others submit one job a second each. A job needs 2 core-seconds on
// a 16-core machine. Running more jobs at once than there are cores shares the cores and wastes some on switching.
// Some jobs fail, some after their side effect already happened. A deploy can restart the workers at 151 s.
// Everything is integers from a seeded generator, so the output never changes.
using System;
using System.Collections.Generic;
using System.Linq;

class Job
{
    public int Tenant, T0, Tries, Prog;
    public bool Effect;
}

class Program
{
    const int Ticks = 500, Tenants = 4;
    const int Cores = 16;            // cores per machine
    const int Cost = 2000;           // work units a job needs; a core does 1,000 a second
    const int MaxThreads = 250;      // a thread per job: past this many at once the process runs out of memory and dies
    const int BurstAt = 100, BurstEnd = 200, Burst = 12;
    const int QMax = 200, FairQMax = 50; // bounded queue: all tenants together, or per tenant
    const int FailPct = 10, EffectPct = 50, MaxTries = 3; // a failure happens after the side effect half of the time
    const int RestartAt = 151, Drain = 10, Gap = 5;
    const int CheckEvery = 10, WaitLimit = 5, Boot = 20, MaxMachines = 4; // autoscaler on the age of the oldest job

    static int Rate(int n, int cores)
    {
        if (n <= cores) return 1000;
        int ovh = Math.Min(600, (n - cores) * 8);
        return (1000 * cores / n) * (1000 - ovh) / 1000;
    }

    static void Run(string name, string exec, string queue, bool noisy, string retry, string deploy)
    {
        long seed = 4242;
        long Rnd() { seed = (seed * 48271) % 2147483647; return seed; }
        var shared = new List<Job>();
        var per = new List<Job>[] { new(), new(), new(), new() };
        var pending = new List<int>();
        var running = new List<Job>();
        int machines = 1, rr = 0, resumeAt = -1, drainEnd = -1;
        bool paused = false;
        var sub = new int[2]; var rej = new int[2]; var done = new int[2]; // [noisy, others]
        var lat = new Dictionary<int, int>();
        int lost = 0, lostOthers = 0, crashes = 0, killed = 0, dup = 0, failed = 0, dead = 0, peak = 0, machineTicks = 0;

        int G(int tenant) => tenant == 0 ? 0 : 1;
        int Queued() => queue == "fair" ? per.Sum(q => q.Count) : shared.Count;
        void Lose(Job j) { lost++; if (j.Tenant != 0) lostOthers++; }
        void Answer(Job j, int t) { if (j.Tenant != 0) { int d = t - j.T0 + 1; lat[d] = lat.GetValueOrDefault(d) + 1; } } // the caller got an answer
        void Finish(Job j, int t) { done[G(j.Tenant)]++; Answer(j, t); }
        void Requeue(Job j) { (queue == "fair" ? per[j.Tenant] : shared).Add(j); }
        int Workers() => exec == "auto" ? Cores * machines : int.Parse(exec);

        for (int t = 0; t < Ticks; t++)
        {
            for (int i = pending.Count - 1; i >= 0; i--) if (pending[i] <= t) { machines++; pending.RemoveAt(i); }
            for (int tenant = 0; tenant < Tenants; tenant++)
            {
                int n = tenant == 0 ? (noisy && t >= BurstAt && t < BurstEnd ? Burst : t % 2 == 0 ? 1 : 0) : 1;
                for (int k = 0; k < n; k++)
                {
                    var j = new Job { Tenant = tenant, T0 = t };
                    sub[G(tenant)]++;
                    if (exec == "thread") running.Add(j);
                    else if (queue == "fair") { if (per[tenant].Count >= FairQMax) rej[G(tenant)]++; else per[tenant].Add(j); }
                    else if (queue == "bounded" && shared.Count >= QMax) rej[G(tenant)]++;
                    else shared.Add(j);
                }
            }
            if (exec == "thread" && running.Count > MaxThreads) { crashes++; foreach (var j in running) Lose(j); running = new List<Job>(); }
            if (t == RestartAt && deploy != "none")
            {
                if (exec == "thread" || deploy == "abrupt")
                {
                    foreach (var j in running) { killed++; if (exec == "thread" || retry == "none") Lose(j); else { j.Prog = 0; Requeue(j); } }
                    running = new List<Job>();
                    resumeAt = exec == "thread" ? t : t + Gap;
                }
                else { paused = true; drainEnd = t + Drain; }
            }
            if (paused && (running.Count == 0 || t >= drainEnd))
            {
                foreach (var j in running) { killed++; if (retry == "none") Lose(j); else { j.Prog = 0; Requeue(j); } }
                running = new List<Job>();
                paused = false; resumeAt = t + Gap;
            }
            if (exec == "auto" && t % CheckEvery == 0)
            {
                int oldest = 0;
                foreach (var q in queue == "fair" ? per : new[] { shared }) if (q.Count > 0) oldest = Math.Max(oldest, t - q[0].T0);
                if (oldest > WaitLimit && machines + pending.Count < MaxMachines) pending.Add(t + Boot);
                else if (Queued() == 0 && machines > 1 && pending.Count == 0) machines--;
            }
            if (exec != "thread" && !paused && t >= resumeAt)
            {
                while (running.Count < Workers() && Queued() > 0)
                {
                    if (queue == "fair")
                    {
                        int tenant = rr;
                        while (per[tenant].Count == 0) tenant = (tenant + 1) % Tenants;
                        running.Add(per[tenant][0]); per[tenant].RemoveAt(0);
                        rr = (tenant + 1) % Tenants;
                    }
                    else { running.Add(shared[0]); shared.RemoveAt(0); }
                }
            }
            machineTicks += exec == "auto" ? machines : 1;
            peak = Math.Max(peak, running.Count);
            int r = Rate(running.Count, Cores * (exec == "auto" ? machines : 1));
            var still = new List<Job>();
            foreach (var j in running)
            {
                j.Prog += r;
                if (j.Prog < Cost) { still.Add(j); continue; }
                if (Rnd() % 100 >= FailPct) { if (j.Effect) dup++; j.Effect = true; Finish(j, t); continue; }
                if (Rnd() % 100 < EffectPct) { if (j.Effect) dup++; j.Effect = true; }
                if (retry == "none") { failed++; Answer(j, t); continue; }
                if (j.Effect && retry == "idem") { Finish(j, t); continue; }
                j.Tries++;
                if (j.Tries >= MaxTries) { dead++; Answer(j, t); continue; }
                j.Prog = 0;
                if (exec == "thread") still.Add(j); else Requeue(j);
            }
            running = still;
        }
        int admitted = sub[1] - rej[1];
        int seen = 0, p95 = -1;
        foreach (var k in lat.Keys.OrderBy(x => x)) { seen += lat[k]; if (p95 < 0 && seen * 100 >= admitted * 95) p95 = k; }
        Console.WriteLine($"-- {name}");
        Console.WriteLine($"  other tenants: p95 {(p95 < 0 || p95 > Ticks ? "over 500 s" : p95 + " s")}; {done[1]} of {sub[1]} done, {rej[1]} rejected, {lostOthers} lost");
        Console.WriteLine($"  noisy tenant: {done[0]} of {sub[0]} done, {rej[0]} rejected");
        Console.WriteLine($"  peak {peak} running at once, {crashes} crashes, {killed} killed by the deploy, {lost} jobs lost, {machineTicks} machine-seconds");
        Console.WriteLine($"  duplicate side effects {dup}, failed without retry {failed}, given up after {MaxTries} tries {dead}");
        if (done[0] + done[1] + rej[0] + rej[1] > sub[0] + sub[1]) throw new Exception("impossible count");
    }

    static void Main()
    {
        Run("a thread per job, noisy tenant", "thread", "unbounded", true, "none", "none");
        Run("16 workers, one unbounded queue", "16", "unbounded", true, "none", "none");
        Run("64 workers, one unbounded queue", "64", "unbounded", true, "none", "none");
        Run("16 workers, bounded queue of 200", "16", "bounded", true, "none", "none");
        Run("16 workers, fair queues of 50 each", "16", "fair", true, "none", "none");
        Run("autoscaled, fair queues", "auto", "fair", true, "none", "none");
        Run("16 workers, fair, no noisy tenant", "16", "fair", false, "none", "none");
        Run("16 workers, fair, retries without idempotency", "16", "fair", true, "retry", "none");
        Run("16 workers, fair, retries with idempotency", "16", "fair", true, "idem", "none");
        Run("16 workers, fair, idempotent, abrupt restart", "16", "fair", true, "idem", "abrupt");
        Run("16 workers, fair, idempotent, drain then restart", "16", "fair", true, "idem", "drain");
    }
}
