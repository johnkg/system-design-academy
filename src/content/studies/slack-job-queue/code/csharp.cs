// A miniature of the idea in Slack's "Scaling Slack's Job Queue" (2017), in C# (a teaching model, not Slack's code):
// a durable log (Kafka's role) sits in front of a small in-memory queue (Redis's role). A relay moves jobs from the log
// to the queue under a rate limit and moves its offset forward only after the queue accepted the job.
// The first run has no log, so a full queue rejects new jobs. The second run uses the log.
// Everything is deterministic, so every run prints the same thing. All numbers are made up for teaching.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

const int Partitions = 2; // log partitions (Slack's topics have 32)
const int RedisLimit = 4; // jobs the in-memory queue can hold
const int Rate = 2; // most jobs the relay may write to the queue per tick
const int Drain = 1; // jobs the workers finish per tick
const int BurstTicks = 4; // ticks in which new jobs arrive
const int PerTick = 3; // new jobs per tick
const int RedisDownTick = 3; // a tick in which the queue cannot be written to

// 32-bit FNV-1a, used to choose a partition from the job id.
static uint Fnv(string text)
{
    uint h = 0x811C9DC5;
    foreach (var b in Encoding.UTF8.GetBytes(text)) h = unchecked((h ^ b) * 0x01000193);
    return h;
}

// Ids of the jobs arriving in a tick. Job 2 is sent twice in tick 1, as a client retry might do.
static List<string> Arrivals(int tick)
{
    var ids = new List<string>();
    if (tick > BurstTicks) return ids;
    for (var i = 0; i < PerTick; i++) ids.Add($"job-{(tick - 1) * PerTick + i + 1}");
    if (tick == 1) ids[2] = "job-2";
    return ids;
}

// Limited deduplication: a job whose id is already waiting is discarded.
static void RedisAdd(List<string> queue, string job)
{
    if (!queue.Contains(job)) queue.Add(job);
}

static int Direct()
{
    Console.WriteLine("--- without a log: producers write straight to the queue");
    var queue = new List<string>();
    var rejected = 0;
    for (var tick = 1; tick <= BurstTicks; tick++)
    {
        var lost = 0;
        foreach (var job in Arrivals(tick))
        {
            if (queue.Count >= RedisLimit) lost++;
            else RedisAdd(queue, job);
        }
        rejected += lost;
        queue = queue.Skip(Drain).ToList();
        Console.WriteLine($"tick {tick}: arrived {PerTick}, rejected {lost}, queue {queue.Count}");
    }
    Console.WriteLine($"rejected in total: {rejected}");
    return rejected;
}

static List<string> WithLog()
{
    Console.WriteLine("--- with a log in front: producers append to the log, a relay feeds the queue");
    var log = Enumerable.Range(0, Partitions).Select(_ => new List<string>()).ToArray();
    var offset = new int[Partitions]; // next entry the relay will read, per partition
    var queue = new List<string>();
    var done = new List<string>();
    for (var tick = 1; tick < 30; tick++)
    {
        foreach (var job in Arrivals(tick)) log[(int)(Fnv(job) % Partitions)].Add(job); // always accepted
        var moved = 0;
        if (tick != RedisDownTick)
        {
            for (var p = 0; p < Partitions; p++)
            {
                while (moved < Rate && offset[p] < log[p].Count && queue.Count < RedisLimit)
                {
                    RedisAdd(queue, log[p][offset[p]]);
                    offset[p]++; // committed only after the queue took the job
                    moved++;
                }
            }
        }
        done.AddRange(queue.Take(Drain));
        queue = queue.Skip(Drain).ToList();
        var lag = 0;
        for (var p = 0; p < Partitions; p++) lag += log[p].Count - offset[p];
        var note = tick == RedisDownTick ? " (queue unreachable)" : "";
        Console.WriteLine($"tick {tick}: arrived {Arrivals(tick).Count}, relayed {moved}, queue {queue.Count}, waiting in log {lag}{note}");
        if (tick > BurstTicks && lag == 0 && queue.Count == 0) break;
    }
    return done;
}

var rejectedTotal = Direct();
var finished = WithLog();
Console.WriteLine($"finished {finished.Count} distinct jobs, none rejected, first {finished[0]}, last {finished[finished.Count - 1]}");
var ok = rejectedTotal > 0 && finished.Count == finished.Distinct().Count() && finished.Count == BurstTicks * PerTick - 1;
Console.WriteLine($"checks {(ok ? "passed" : "FAILED")}");
if (!ok) Environment.Exit(1);
