// A service registry in C#: heartbeats renew leases, a sweep evicts expired ones,
// self-preservation stops the sweep when too many renewals vanish at once, and a client cache follows a versioned event log.
using System;
using System.Collections.Generic;
using System.Linq;

const int EVERY = 10, N = 20; // seconds between heartbeats, instances

var results = new Dictionary<bool, Dictionary<int, string>>();
foreach (var sp in new[] { false, true })
{
    var (output, reg) = Run(sp);
    results[sp] = output;
    Console.WriteLine($"self-preservation {(sp ? "on " : "off")}: t=90 {output[90]} | t=140 {output[140]} | events={reg.Log.Count} skipped-sweeps={reg.Skipped}");
}
if (!results[false][90].StartsWith("listed=10 healthy-missing=8")) Environment.Exit(1);  // without it, a partition empties the list
if (!results[true][90].Contains("healthy-missing=0")) Environment.Exit(1);               // with it, nobody healthy is dropped
if (!results[true][140].Contains("dead-listed=0")) Environment.Exit(1);                  // and the dead are removed once the network heals
Console.WriteLine("invariants hold");

(Dictionary<int, string>, Registry) Run(bool selfPreservation)
{
    var reg = new Registry(selfPreservation);
    var cache = new ClientCache();
    var output = new Dictionary<int, string>();
    for (int t = 0; t <= 140; t++)
    {
        for (int id = 0; id < N; id++)
        {
            bool crashed = id >= 8 && id < 10 && t >= 40;   // two instances really die at t=40
            bool cut = id < 8 && t >= 40 && t < 100;         // eight healthy ones lose the registry for 60 s
            if (t % EVERY == id % EVERY && !crashed && !cut) reg.Heartbeat(id, t);
        }
        reg.Sweep(t);
        cache.CatchUp(reg.Log);
        if (t == 90 || t == 140)
        {
            var shown = reg.Listed();
            int missing = Enumerable.Range(0, 8).Count(i => !shown.Contains(i));
            int dead = shown.Count(i => i == 8 || i == 9);
            output[t] = $"listed={shown.Count} healthy-missing={missing} dead-listed={dead}";
        }
    }
    if (!cache.Items.OrderBy(i => i).SequenceEqual(reg.Listed())) Environment.Exit(1);
    return (output, reg);
}

static class Cfg { public const int TTL = 30, THRESHOLD = 85; } // seconds, percent

record Change(int V, string Op, int Id);

class Registry(bool sp)
{
    readonly Dictionary<int, int> last = new();   // instance id -> time of its last heartbeat
    List<int> renewals = new();                   // the times of recent heartbeats
    public List<Change> Log = new();              // versioned changes that watchers receive
    public int Skipped;

    public void Heartbeat(int id, int now)
    {
        if (!last.ContainsKey(id)) Log.Add(new Change(Log.Count + 1, "add", id)); // an unknown id registers again
        last[id] = now;
        renewals.Add(now);
    }

    public void Sweep(int now)
    {
        renewals = renewals.Where(t => t > now - Cfg.TTL).ToList();
        int expected = last.Count * (Cfg.TTL / 10);
        if (sp && renewals.Count * 100 < Cfg.THRESHOLD * expected) { Skipped++; return; } // too many silent: suspect the network, not the instances
        foreach (var (id, seen) in last.ToList())
        {
            if (now - seen > Cfg.TTL) { last.Remove(id); Log.Add(new Change(Log.Count + 1, "evict", id)); }
        }
    }

    public List<int> Listed() => last.Keys.OrderBy(i => i).ToList();
}

class ClientCache // applies the log in order, and would ask for a full copy if it ever saw a gap
{
    int version;
    public HashSet<int> Items = new();

    public void CatchUp(List<Change> log)
    {
        foreach (var e in log.Where(x => x.V > version).ToList())
        {
            if (e.V != version + 1) throw new Exception("gap");
            if (e.Op == "add") Items.Add(e.Id); else Items.Remove(e.Id);
            version = e.V;
        }
    }
}
