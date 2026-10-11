// A tiny cluster control plane in C#:
// controllers compare desired and actual state, a scheduler filters then scores nodes,
// and a node controller evicts the pods of a node whose heartbeats stop for longer than the grace period.
using System;
using System.Collections.Generic;
using System.Linq;

public record Deployment(string Name, int Replicas, int Cpu, int Mem);
public class Node { public int Id; public int LastBeat; public bool Ready = true; public bool Dead; }
public class Pod { public int Id; public string Dep = ""; public int Cpu; public int Mem; public int Node = -1; }
public class Result
{
    public int Evictions, FalseEvictions, Killed = -1, KilledPods, NotReadyAt = -1, RestoredAt = -1, MaxCpu, MaxMem, FinalBound;
    public string Spread = "";
}

public static class Program
{
    const int Nodes = 8, Cpu = 16, Mem = 64, Beat = 10, End = 200;
    static readonly Deployment[] Deployments = { new("web", 16, 2, 4), new("cache", 4, 1, 16), new("batch", 6, 4, 8) };

    static Result Simulate(int grace, int lossPercent, int killAt)
    {
        long seed = 42;
        int Random(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)(seed / 65536 % n); }

        var nodes = Enumerable.Range(0, Nodes).Select(i => new Node { Id = i }).ToList();
        var pods = new List<Pod>(); // the store: every pod object, with the node it is bound to (-1 while unscheduled)
        int nextId = 1;
        var r = new Result();

        int Used(Node n, Func<Pod, int> key) => pods.Where(p => p.Node == n.Id).Sum(key);
        int Count(Node n) => pods.Count(p => p.Node == n.Id);

        // Filter: ready nodes with enough unrequested CPU and memory. Score: the most even CPU and memory use afterwards. Ties go to the lower id.
        void Schedule(Pod pod)
        {
            Node? best = null; int bestScore = int.MaxValue;
            foreach (var n in nodes)
            {
                int freeCpu = Cpu - Used(n, p => p.Cpu) - pod.Cpu, freeMem = Mem - Used(n, p => p.Mem) - pod.Mem;
                if (!n.Ready || freeCpu < 0 || freeMem < 0) continue;
                int score = Math.Abs(freeCpu * 1000 / Cpu - freeMem * 1000 / Mem);
                if (score < bestScore) { best = n; bestScore = score; }
            }
            if (best != null) pod.Node = best.Id;
        }

        for (int t = 1; t <= End; t++)
        {
            if (t == killAt) // the busiest node loses power
            {
                var victim = nodes[0];
                foreach (var n in nodes) if (Count(n) > Count(victim)) victim = n;
                victim.Dead = true; r.Killed = victim.Id; r.KilledPods = Count(victim);
            }
            foreach (var n in nodes) // kubelets send a heartbeat every Beat seconds; a lossy network drops some of them
            {
                if (t % Beat != n.Id % Beat || n.Dead) continue;
                if (Random(100) >= lossPercent) { n.LastBeat = t; n.Ready = true; }
            }
            foreach (var n in nodes) // node controller: no heartbeat for longer than the grace period means NotReady, so evict its pods
            {
                if (n.Ready && t - n.LastBeat > grace)
                {
                    n.Ready = false; r.Evictions++;
                    if (!n.Dead) r.FalseEvictions++; else r.NotReadyAt = t;
                    pods.RemoveAll(p => p.Node == n.Id);
                }
            }
            foreach (var d in Deployments) // replica controller: make the actual count match the desired count
            {
                int have = pods.Count(p => p.Dep == d.Name);
                for (int i = have; i < d.Replicas; i++) pods.Add(new Pod { Id = nextId++, Dep = d.Name, Cpu = d.Cpu, Mem = d.Mem });
            }
            foreach (var p in pods.Where(p => p.Node < 0).Take(4).ToList()) Schedule(p); // the scheduler binds at most 4 pods per second
            foreach (var n in nodes) { r.MaxCpu = Math.Max(r.MaxCpu, Used(n, p => p.Cpu)); r.MaxMem = Math.Max(r.MaxMem, Used(n, p => p.Mem)); }
            if (t == 20) r.Spread = string.Join(" ", nodes.Select(Count));
            if (r.Killed >= 0 && t > killAt && r.RestoredAt < 0 && pods.Count == 26 && pods.All(p => p.Node >= 0 && !nodes[p.Node].Dead)) r.RestoredAt = t;
        }
        r.FinalBound = pods.Count(p => p.Node >= 0 && !nodes[p.Node].Dead);
        return r;
    }

    public static int Main()
    {
        var a = Simulate(40, 0, 100);
        Console.WriteLine($"pods per node at t=20: {a.Spread}");
        Console.WriteLine($"node {a.Killed} died at t=100 with {a.KilledPods} pods; marked NotReady at t={a.NotReadyAt}; all 26 pods bound again at t={a.RestoredAt}");
        var b = Simulate(5, 10, -1); var c = Simulate(40, 10, -1);
        Console.WriteLine($"healthy nodes, 10% of heartbeats lost: grace 5 s gives {b.FalseEvictions} false evictions, grace 40 s gives {c.FalseEvictions}");

        bool ok = a.MaxCpu <= Cpu && a.MaxMem <= Mem && b.MaxCpu <= Cpu && b.MaxMem <= Mem
            && a.FinalBound == 26 && a.RestoredAt > a.NotReadyAt && a.NotReadyAt - 100 <= 40 + Beat + 1
            && b.FalseEvictions > 0 && c.FalseEvictions == 0;
        Console.WriteLine($"no node over-committed, desired equals actual, no flapping at 40 s: {ok.ToString().ToLowerInvariant()}");
        return ok ? 0 : 1;
    }
}
