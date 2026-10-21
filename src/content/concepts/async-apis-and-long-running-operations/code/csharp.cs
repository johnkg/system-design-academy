// A job service: idempotent create, status, leased workers and a polling comparison.
// The clock is an integer "second" that the loop advances by hand, so the output is deterministic.
using System;
using System.Collections.Generic;
using System.Linq;

const int Workers = 2, Seed = 7, CrashAt = 4, MaxTicks = 100; // worker 0 crashes at t = CrashAt
const int PollCap = 16; // longest wait between polls (s)
const int DoneAt = 45; // the polled job finishes at this second
const int Clients = 1000000;

var svc = new JobService(Workers, Seed);
int a = svc.Create(0, "key-a");
svc.Create(0, "key-b");
int aAgain = svc.Create(0, "key-a"); // the client retried a lost 202
if (aAgain != a || svc.Jobs.Count != 2) throw new Exception("same key must return the same job");
svc.Create(1, "key-c");
int t = 0;
while (svc.Jobs.Values.Any(j => j.State != "succeeded"))
{
    t += 1;
    svc.Tick(t, t == CrashAt ? 0 : -1);
    if (t >= MaxTicks) throw new Exception("did not finish");
}
if (svc.Results.Count != 3 || !svc.Jobs.Values.All(j => j.State == "succeeded")) throw new Exception("results");
Console.WriteLine($"jobs: {svc.Jobs.Count}, results stored: {svc.Results.Count}, runs: [{string.Join(", ", svc.Jobs.Values.Select(j => j.Runs))}]");

// Poll at `first` seconds, then wait growth*previous (capped at 16); stop when the job is done.
static List<int> PollTimes(int doneAt, int first, int growth)
{
    var times = new List<int>();
    int wait = first, now = 0;
    while (true)
    {
        now += wait;
        times.Add(now);
        if (now >= doneAt) return times;
        wait = Math.Min(PollCap, wait * growth);
    }
}

var fixedPolls = PollTimes(DoneAt, 1, 1);
var backoff = PollTimes(DoneAt, 2, 2);
Console.WriteLine($"fixed 1 s: {fixedPolls.Count} polls, result seen at {fixedPolls[^1]} s");
Console.WriteLine($"backoff 2,4,8,16: {backoff.Count} polls, result seen at {backoff[^1]} s");
if (!(backoff.Count < fixedPolls.Count && backoff[^1] - DoneAt < PollCap)) throw new Exception("backoff must cost fewer calls");
Console.WriteLine($"1,000,000 clients: {Clients} req/s fixed, {(long)Clients * backoff.Count / DoneAt} req/s average with backoff");

class Job
{
    public int Id, Work, Left, Lease, Runs;
    public string State = "pending";
}

class JobService
{
    const int Lease = 4;
    const int WorkMin = 6, WorkSpread = 10; // a job needs 6..15 s of work
    const int RestartDelay = 2; // seconds before a crashed worker comes back
    public SortedDictionary<int, Job> Jobs = new();
    public Dictionary<int, string> Results = new();
    Dictionary<string, int> byKey = new();
    List<Job> queue = new();
    Job?[] workers;
    int[] downUntil; // a crashed worker restarts after 2 s
    uint state;

    public JobService(int n, uint seed) { workers = new Job?[n]; downUntil = new int[n]; state = seed; }

    uint Next() { state = unchecked(state * 1664525u + 1013904223u); return state; }

    void Log(int t, Job job, string text) => Console.WriteLine($"t={t,2} op_{job.Id} {text}");

    // POST /reports: the same key always returns the same operation.
    public int Create(int t, string key)
    {
        if (byKey.TryGetValue(key, out int existing)) return existing;
        int work = WorkMin + (int)(Next() % WorkSpread);
        var job = new Job { Id = Jobs.Count + 1, Work = work, Left = work };
        Jobs[job.Id] = job;
        byKey[key] = job.Id;
        queue.Add(job);
        Log(t, job, $"pending ({job.Work} s of work)");
        return job.Id;
    }

    // GET /operations/{id}
    public string Status(int opId) => Jobs[opId].State;

    public void Tick(int t, int crashWorker = -1)
    {
        if (crashWorker >= 0 && workers[crashWorker] != null)
        {
            var job = workers[crashWorker]!;
            Log(t, job, $"worker {crashWorker} crashed, lease stays at t={job.Lease}");
            workers[crashWorker] = null; // the job stays 'running' until its lease expires
            downUntil[crashWorker] = t + RestartDelay;
        }
        foreach (var job in Jobs.Values)
        {
            if (job.State == "running" && job.Lease <= t && !workers.Contains(job))
            {
                job.State = "pending";
                job.Left = job.Work; // start over from the beginning
                queue.Insert(0, job);
                Log(t, job, "lease expired, back to pending");
            }
        }
        for (int i = 0; i < workers.Length; i++)
        {
            var job = workers[i];
            if (job == null) continue;
            job.Left -= 1;
            job.Lease = t + Lease;
            if (job.Left == 0)
            {
                job.State = "succeeded";
                Results[job.Id] = $"report-{job.Id}"; // a put under the job id, so a re-run overwrites
                workers[i] = null;
                Log(t, job, $"succeeded after {job.Runs} run(s)");
            }
        }
        for (int i = 0; i < workers.Length; i++)
        {
            if (workers[i] == null && queue.Count > 0 && t >= downUntil[i])
            {
                var next = workers[i] = queue[0];
                queue.RemoveAt(0);
                next.State = "running";
                next.Runs += 1;
                next.Lease = t + Lease;
                Log(t, next, $"running on worker {i}");
            }
        }
    }
}
