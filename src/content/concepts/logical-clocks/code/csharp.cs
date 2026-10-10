// Lamport and vector clocks in C#, on a small fixed scenario.
// Processes: A, B, C. A sends a message to B, and B sends one to C. C also does something on its own.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    static readonly string[] Procs = { "A", "B", "C" };
    static readonly Dictionary<string, int> Lamport = new() { ["A"] = 0, ["B"] = 0, ["C"] = 0 };
    static readonly Dictionary<string, int[]> Vector = new() { ["A"] = new int[3], ["B"] = new int[3], ["C"] = new int[3] };
    static readonly List<(string Name, int Lamport, int[] Vector)> Events = new();

    static void Record(string name, string p) => Events.Add((name, Lamport[p], (int[])Vector[p].Clone()));

    static void Local(string name, string p)
    {
        Lamport[p] += 1;
        Vector[p][Array.IndexOf(Procs, p)] += 1;
        Record(name, p);
    }

    static (int Lamport, int[] Vector) Send(string name, string from)
    {
        Local(name, from);
        return (Lamport[from], (int[])Vector[from].Clone()); // the message carries the sender's clocks
    }

    static void Receive(string name, string to, (int Lamport, int[] Vector) message)
    {
        Lamport[to] = Math.Max(Lamport[to], message.Lamport) + 1; // jump past the sender's time
        Vector[to] = Vector[to].Select((v, i) => Math.Max(v, message.Vector[i])).ToArray();
        Vector[to][Array.IndexOf(Procs, to)] += 1;
        Record(name, to);
    }

    // Vector comparison: before, after, equal or concurrent
    static string Relation(int[] a, int[] b)
    {
        var lessOrEqual = a.Zip(b).All(p => p.First <= p.Second);
        var greaterOrEqual = a.Zip(b).All(p => p.First >= p.Second);
        if (lessOrEqual && greaterOrEqual) return "equal";
        if (lessOrEqual) return "happened before";
        if (greaterOrEqual) return "happened after";
        return "concurrent";
    }

    public static void Main()
    {
        Local("A1 write x", "A");
        var m1 = Send("A2 send to B", "A");
        Receive("B1 receive from A", "B", m1);
        var m2 = Send("B2 send to C", "B");
        Local("C1 local event", "C"); // happens independently of A and B
        Receive("C2 receive from B", "C", m2);

        foreach (var e in Events) Console.WriteLine($"{e.Name,-20} lamport {e.Lamport}  vector [{string.Join(",", e.Vector)}]");

        var byName = Events.ToDictionary(e => e.Name[..2], e => e);
        foreach (var (x, y) in new[] { ("A1", "C2"), ("A2", "B1"), ("A1", "C1") })
            Console.WriteLine($"{x} vs {y}: {Relation(byName[x].Vector, byName[y].Vector)}  (lamport {byName[x].Lamport} vs {byName[y].Lamport})");
    }
}
