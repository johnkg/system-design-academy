// A miniature of the Borg scheduler from Google's EuroSys 2015 paper, in C# (a teaching model, not Google's code):
// a pending queue scanned from high to low priority, feasibility checking that counts the room taken by lower-priority tasks as
// available, scoring that prefers few stranded resources and few preemptions, preemption of the lowest-priority tasks, a down
// machine whose tasks are rescheduled, and resource reclamation that lends unused production reservations to batch work.
// Everything is deterministic.

using System;
using System.Collections.Generic;
using System.Linq;

const int Prod = 200, Batch = 100;
var machines = new List<Machine>
{
    new Machine("m1", 10, 10), new Machine("m2", 10, 10), new Machine("m3", 8, 16),
};

int UsedCpu(Machine m, int minPrio = 0) => m.Tasks.Where(t => t.Prio >= minPrio).Sum(t => t.Cpu);
int UsedRam(Machine m, int minPrio = 0) => m.Tasks.Where(t => t.Prio >= minPrio).Sum(t => t.Ram);

List<Machine> Candidates(Job task) => machines.Where(m => m.Up && m.Cpu - UsedCpu(m, task.Prio) >= task.Cpu && m.Ram - UsedRam(m, task.Prio) >= task.Ram).ToList();

double Score(Machine m, Job task) // lower is better
{
    double fc = (double)(m.Cpu - UsedCpu(m, task.Prio) - task.Cpu) / m.Cpu;
    double fr = (double)(m.Ram - UsedRam(m, task.Prio) - task.Ram) / m.Ram;
    double stranded = Math.Abs(fc - fr); // one resource left over while the other is used up
    bool fitsNow = m.Cpu - UsedCpu(m) >= task.Cpu && m.Ram - UsedRam(m) >= task.Ram;
    return stranded + (fitsNow ? 0 : 1); // preempting other tasks costs more than using free room
}

void Place(Job task, List<Job> pending)
{
    var best = Candidates(task).OrderBy(m => Score(m, task)).ThenBy(m => m.Name, StringComparer.Ordinal).FirstOrDefault();
    if (best == null)
    {
        Console.WriteLine($"{task.Name} (priority {task.Prio}): no machine, stays pending");
        return;
    }
    var gone = new List<Job>();
    while (best.Cpu - UsedCpu(best) < task.Cpu || best.Ram - UsedRam(best) < task.Ram)
    {
        var victim = best.Tasks.OrderBy(t => t.Prio).First(); // lowest priority first
        best.Tasks.Remove(victim);
        gone.Add(victim);
        pending.Add(victim);
    }
    best.Tasks.Add(task);
    string note = gone.Count > 0 ? $", preempting {string.Join(", ", gone.Select(t => t.Name))}" : "";
    Console.WriteLine($"{task.Name} (priority {task.Prio}, {task.Cpu} cpu, {task.Ram} ram) -> {best.Name}{note}");
}

void Schedule(List<Job> pending) // high priority first, as the scan of the pending queue does
{
    pending.Sort((a, b) => b.Prio.CompareTo(a.Prio));
    while (pending.Count > 0)
    {
        var next = pending[0];
        pending.RemoveAt(0);
        Place(next, pending);
    }
}

void Show() => Console.WriteLine(string.Join(" | ", machines.Select(m => $"{m.Name}{(m.Up ? "" : " (down)")}: {(m.Tasks.Count == 0 ? "-" : string.Join(" ", m.Tasks.Select(t => t.Name)))}")));

Console.WriteLine("--- placing tasks");
var pendingList = new List<Job> { new("web1", Prod, 4, 3), new("web2", Prod, 4, 3), new("batch1", Batch, 5, 5), new("batch2", Batch, 3, 8), new("batch3", Batch, 4, 2) };
Schedule(pendingList);
Show();

Console.WriteLine("--- a production task arrives and needs room");
pendingList = new List<Job> { new("db1", Prod, 8, 8) };
Schedule(pendingList);
Console.WriteLine("running now: " + string.Join(" ", machines.SelectMany(m => m.Tasks).Select(t => t.Name)));

Console.WriteLine("--- a machine stops answering polls");
var down = machines.First(m => m.Tasks.Any(t => t.Name == "web1"));
down.Up = false;
pendingList = down.Tasks.ToList();
down.Tasks.Clear();
Console.WriteLine($"{down.Name} marked down, rescheduling: " + string.Join(" ", pendingList.Select(t => t.Name)));
Schedule(pendingList);
Show();
down.Up = true;
Console.WriteLine($"{down.Name} answers again: the master tells it to kill the copies that were rescheduled, leaving {down.Tasks.Count} tasks on it");

Console.WriteLine("--- resource reclamation");
int limitCpu = 8, usage = 2, margin = 1;
int reservation = usage + margin;
Console.WriteLine($"a production task asks for {limitCpu} cpu but uses {usage}; its reservation is {reservation}, so {limitCpu - reservation} cpu can be lent to batch tasks");
Console.WriteLine($"a batch task needing 4 cpu {(limitCpu - reservation >= 4 ? "fits in reclaimed resources" : "does not fit")}; one needing 6 {(limitCpu - reservation >= 6 ? "fits" : "does not fit")}");

record Job(string Name, int Prio, int Cpu, int Ram);
class Machine
{
    public string Name { get; }
    public int Cpu { get; }
    public int Ram { get; }
    public List<Job> Tasks { get; } = new();
    public bool Up { get; set; } = true;
    public Machine(string name, int cpu, int ram) { Name = name; Cpu = cpu; Ram = ram; }
}
