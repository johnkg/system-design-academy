// A job queue with leases, retries and a dead-letter queue in C#:
// a job that is received but never finished comes back by itself, and doing it twice causes no harm.
using System;
using System.Collections.Generic;
using System.Linq;

public class Job
{
    public string Id = "";
    public int Attempts;
    public int VisibleAt;
    public bool Done;
}

public class JobQueue
{
    readonly int lease, maxAttempts;
    readonly List<Job> jobs = new();
    public readonly List<string> DeadLetters = new();

    public JobQueue(int leaseSeconds, int maxAttempts) { lease = leaseSeconds; this.maxAttempts = maxAttempts; }

    public void Add(string id) => jobs.Add(new Job { Id = id });

    // Hand out the next job that is visible. It becomes invisible for the lease time; if nobody acks it, it will reappear.
    public Job? Receive(int now)
    {
        foreach (var job in jobs)
        {
            if (job.Done || job.VisibleAt > now) continue;
            if (job.Attempts >= maxAttempts) { job.Done = true; DeadLetters.Add(job.Id); continue; } // too many tries: set it aside for a person
            job.Attempts++; job.VisibleAt = now + lease;
            return job;
        }
        return null;
    }

    public void Ack(string id) => jobs.First(j => j.Id == id).Done = true;
}

public static class Program
{
    static readonly Dictionary<string, int> Effects = new(); // what the jobs actually did in the world (an invoice sent, for example)
    static readonly HashSet<string> RunLog = new();          // a record of finished work, keyed by job id

    // The handler is idempotent: it first looks at the run log, so a repeat delivery does not repeat the effect.
    static void Handle(Job job, string worker, bool crashesAfterEffect)
    {
        if (job.Id == "poison") throw new Exception("this job always fails");
        if (!RunLog.Contains(job.Id))
        {
            Effects[job.Id] = Effects.GetValueOrDefault(job.Id) + 1; // the real work
            RunLog.Add(job.Id);
        }
        if (crashesAfterEffect) throw new Exception($"{worker} crashed after doing the work, before acknowledging it");
    }

    public static int Main()
    {
        var queue = new JobQueue(30, 3); // 30-second lease, at most 3 attempts
        foreach (var id in new[] { "invoice-1", "invoice-2", "poison" }) queue.Add(id);

        // Script of what goes wrong: worker A dies without doing invoice-1, worker B does invoice-2 but dies before the ack.
        var crashPlan = new Dictionary<string, string[]>
        {
            ["invoice-1"] = new[] { "dies before starting" },
            ["invoice-2"] = new[] { "crash after work" },
        };
        var log = new List<string>();
        for (int now = 0; now <= 200; now += 10)
        {
            var job = queue.Receive(now);
            if (job == null) continue;
            string? plan = crashPlan.TryGetValue(job.Id, out var steps) && job.Attempts - 1 < steps.Length ? steps[job.Attempts - 1] : null;
            try
            {
                if (plan == "dies before starting") throw new Exception("worker A died");
                Handle(job, "B", plan == "crash after work");
                queue.Ack(job.Id);
                log.Add($"t={now}s {job.Id} attempt {job.Attempts}: done");
            }
            catch (Exception e)
            {
                log.Add($"t={now}s {job.Id} attempt {job.Attempts}: {e.Message}");
            }
        }
        Console.WriteLine(string.Join("\n", log));
        Console.WriteLine($"effects: {string.Join(", ", Effects.OrderBy(e => e.Key, StringComparer.Ordinal).Select(e => $"{e.Key} x{e.Value}"))}   dead letters: {string.Join(", ", queue.DeadLetters)}");
        return Effects.GetValueOrDefault("invoice-1") != 1 || Effects.GetValueOrDefault("invoice-2") != 1 || string.Join(",", queue.DeadLetters) != "poison" ? 1 : 0;
    }
}
