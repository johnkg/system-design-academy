// A gang scheduler for a small GPU cluster, in C#:
// a job gets all its GPUs at once or waits, teams are ordered by fair share, placement keeps a big job inside one rack,
// and backfill lets short jobs use the gaps without delaying the job at the head of the queue.
using System;
using System.Collections.Generic;
using System.Linq;

const int NODES = 8, PER_NODE = 8, RACK = 4; // 8 nodes of 8 GPUs, 2 racks of 4 nodes (64 GPUs)
long seed = 7;
int Random(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)((seed / 65536) % n); }

int[] sizes = { 1, 2, 4, 8, 8, 16, 16, 32 };
var jobs = new List<Job>();
for (int i = 0; i < 40; i++) { int g = sizes[Random(8)], team = Random(3), dur = 2 + Random(9), submit = Random(8); jobs.Add(new Job { Id = i, Gpus = g, Team = team, Dur = dur, Submit = submit }); }
jobs = jobs.OrderBy(j => j.Submit * 100 + j.Id).ToList();

// Returns (node, count) pairs or null. Small jobs: the tightest node that fits. Big jobs: whole free nodes inside one rack.
List<(int, int)>? Place(int[] free, int gpus)
{
    if (gpus <= PER_NODE)
    {
        int best = -1;
        for (int n = 0; n < NODES; n++) if (free[n] >= gpus && (best < 0 || free[n] < free[best])) best = n;
        return best < 0 ? null : new List<(int, int)> { (best, gpus) };
    }
    int need = gpus / PER_NODE;
    for (int r = 0; r < NODES / RACK; r++)
    {
        var whole = new List<(int, int)>();
        for (int n = r * RACK; n < (r + 1) * RACK; n++) if (free[n] == PER_NODE) whole.Add((n, PER_NODE));
        if (whole.Count >= need) return whole.Take(need).ToList();
    }
    return null;
}

(int makespan, int wait, int util, int[] usage) Run(bool backfill)
{
    var free = Enumerable.Repeat(PER_NODE, NODES).ToArray();
    var usage = new int[3];
    var pending = jobs.Select(j => new Job { Id = j.Id, Gpus = j.Gpus, Team = j.Team, Dur = j.Dur, Submit = j.Submit }).ToList();
    var running = new List<Job>();
    int done = 0, waitSum = 0, busy = 0, t = 0;
    for (; done < jobs.Count && t < 1000; t++)
    {
        foreach (var j in running.Where(r => r.End == t).ToList()) { foreach (var (n, c) in j.Slots!) free[n] += c; done++; }
        running = running.Where(r => r.End != t).ToList();
        var queue = pending.Where(j => j.Submit <= t && j.Slots == null).OrderBy(j => usage[j.Team]).ThenBy(j => j.Submit).ThenBy(j => j.Id).ToList();
        int shadow = -1; // when the blocked head could start, once the running jobs finish
        foreach (var j in queue)
        {
            if (shadow >= 0 && !(backfill && t + j.Dur <= shadow)) continue;
            var slots = Place(free, j.Gpus);
            if (slots != null)
            {
                foreach (var (n, c) in slots) free[n] -= c;
                if (slots.Sum(s => s.Item2) != j.Gpus || free.Any(f => f < 0)) throw new Exception("gang broken");
                j.Slots = slots; j.End = t + j.Dur; running.Add(j); waitSum += t - j.Submit;
                continue;
            }
            if (shadow < 0)
            {
                if (!backfill) break;
                var copy = (int[])free.Clone();
                foreach (var r in running.OrderBy(r => r.End).ToList())
                {
                    foreach (var (n, c) in r.Slots!) copy[n] += c;
                    if (Place(copy, j.Gpus) != null) { shadow = r.End; break; }
                }
            }
        }
        foreach (var r in running) { usage[r.Team] += r.Gpus; busy += r.Gpus; }
    }
    if (done != jobs.Count || free.Any(f => f != PER_NODE)) throw new Exception("not all jobs finished");
    return (t, waitSum / jobs.Count, 100 * busy / (t * NODES * PER_NODE), usage);
}

var fifo = Run(false); var fill = Run(true);
Console.WriteLine($"jobs: {jobs.Count}, GPUs requested in total: {jobs.Sum(j => j.Gpus)}, cluster: {NODES * PER_NODE} GPUs");
foreach (var (name, r) in new[] { ("strict queue", fifo), ("with backfill", fill) })
    Console.WriteLine($"{name}: finished at t={r.makespan}, average wait {r.wait}, utilisation {r.util}%, GPU-ticks per team {string.Join("/", r.usage)}");
Console.WriteLine($"backfill finishes {fifo.makespan - fill.makespan} ticks earlier");

class Job { public int Id, Gpus, Team, Dur, Submit, End; public List<(int, int)>? Slots; }
