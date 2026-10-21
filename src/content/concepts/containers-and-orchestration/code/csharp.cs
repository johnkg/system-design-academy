// A tiny orchestrator: a scheduler (filter by free CPU/memory, score by policy) and a reconcile loop
// that restores the desired replica count after a node is lost. Integers only, so output is exact.
using System;
using System.Collections.Generic;
using System.Linq;

const int Nodes = 4; // nodes in the demo cluster
const int Replicas = 6; // desired replicas in the failover demo
const int ManyReplicas = 14; // more replicas than the cluster can hold with one node down
const int ExpectedRunning = 12; // 3 surviving nodes x 4 pods of 1000 millicores

var spec = new Spec(1000, 1024);

foreach (var policy in new[] { "spread", "pack" })
{
    var c = new Cluster(Nodes);
    int pending = c.Reconcile(Replicas, spec, policy);
    Console.WriteLine($"{policy}: placed 6 pods -> {c.Counts()} (pending {pending})");
    int max = Enumerable.Range(0, Nodes).Max(j => c.PodsOn(j));
    int victim = Enumerable.Range(0, Nodes).First(i => c.PodsOn(i) == max);
    int lost = c.KillNode(victim);
    Console.WriteLine($"{policy}: {c.Nodes[victim].Name} died, {lost} pods lost, {c.Running()} of 6 running");
    pending = c.Reconcile(Replicas, spec, policy);
    Console.WriteLine($"{policy}: reconciled -> {c.Counts()} (running {c.Running()}, pending {pending})");
    c.Check(spec);
    if (c.Running() != Replicas || pending != 0) throw new Exception("did not converge");
}

var d = new Cluster(Nodes);
d.Reconcile(ManyReplicas, spec, "spread");
d.KillNode(0);
int pend = d.Reconcile(ManyReplicas, spec, "spread");
Console.WriteLine($"14 replicas, 1 node down -> {d.Counts()} (running {d.Running()}, pending {pend})");
if (d.Running() != ExpectedRunning || pend != ManyReplicas - ExpectedRunning) throw new Exception("expected 12 running and 2 pending");
d.Nodes[0].Up = true; // the node comes back
pend = d.Reconcile(ManyReplicas, spec, "spread");
Console.WriteLine($"node back -> {d.Counts()} (running {d.Running()}, pending {pend})");
d.Check(spec);
if (pend != 0) throw new Exception("pending pods should have been scheduled");

record Spec(int Cpu, int Mem);

class Node { public string Name = ""; public bool Up = true; }
class Pod { public int Id; public int Node = -1; }

class Cluster
{
    const int NodeCpu = 4000; // millicores per node
    const int NodeMem = 8192; // MiB per node

    public List<Node> Nodes = new();
    public List<Pod> Pods = new();
    int nextId = 1;

    public Cluster(int count)
    {
        for (int i = 1; i <= count; i++) Nodes.Add(new Node { Name = $"n{i}" });
    }

    public int PodsOn(int i) => Pods.Count(p => p.Node == i);
    public int Running() => Pods.Count(p => p.Node != -1);

    // FILTER: a node is feasible if it is up and the sum of requests still fits.
    // SCORE: percent of CPU + percent of memory that would be requested after placing the pod.
    //        spread prefers the lowest score (emptiest), pack prefers the highest (fullest that fits).
    int Schedule(Spec spec, string policy)
    {
        int best = -1, bestScore = 0;
        for (int i = 0; i < Nodes.Count; i++)
        {
            if (!Nodes[i].Up) continue;
            int used = PodsOn(i);
            int cpu = used * spec.Cpu + spec.Cpu;
            int mem = used * spec.Mem + spec.Mem;
            if (cpu > NodeCpu || mem > NodeMem) continue; // filtered out
            int score = cpu * 100 / NodeCpu + mem * 100 / NodeMem;
            bool better = best == -1 || (policy == "spread" ? score < bestScore : score > bestScore);
            if (better) { best = i; bestScore = score; }
        }
        return best; // -1 means no node fits: the pod stays Pending
    }

    // RECONCILE: compare desired with actual, create or delete, then try to place Pending pods.
    public int Reconcile(int desired, Spec spec, string policy)
    {
        while (Pods.Count < desired) Pods.Add(new Pod { Id = nextId++ });
        while (Pods.Count > desired) Pods.RemoveAt(Pods.Count - 1);
        foreach (var pod in Pods)
            if (pod.Node == -1) pod.Node = Schedule(spec, policy);
        return Pods.Count(p => p.Node == -1);
    }

    public int KillNode(int i)
    {
        Nodes[i].Up = false;
        int before = Pods.Count;
        Pods = Pods.Where(p => p.Node != i).ToList(); // the pods on it are gone
        return before - Pods.Count;
    }

    public string Counts() => string.Join(" ", Nodes.Select((n, i) => n.Up ? PodsOn(i).ToString() : "X"));

    public void Check(Spec spec)
    {
        for (int i = 0; i < Nodes.Count; i++)
        {
            int n = PodsOn(i);
            if (n * spec.Cpu > NodeCpu || n * spec.Mem > NodeMem) throw new Exception("node over-requested");
        }
    }
}
