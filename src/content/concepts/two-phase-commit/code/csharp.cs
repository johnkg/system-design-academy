// Two-phase commit in C#: a coordinator collects votes, then commits or aborts everywhere.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    static void TwoPhaseCommit(List<Participant> participants, bool coordinatorCrashesAfterVotes = false)
    {
        // Phase 1: ask everyone
        var votes = participants.Select(p => p.Prepare()).ToList();
        Console.WriteLine($"  votes: {string.Join(", ", participants.Select((p, i) => $"{p.Name}={(votes[i] ? "yes" : "no")}"))}");
        var decision = votes.All(v => v) ? "commit" : "abort";
        Console.WriteLine($"  coordinator logs decision: {decision}");

        if (coordinatorCrashesAfterVotes)
        {
            Console.WriteLine("  coordinator CRASHES before telling anyone");
        }
        else
        {
            // Phase 2: tell everyone
            foreach (var p in participants) { if (decision == "commit") p.Commit(); else p.Abort(); }
        }
        Console.WriteLine($"  final states: {string.Join(" | ", participants.Select(p => $"{p.Name}: {p.State}"))}");
    }

    public static void Main()
    {
        Console.WriteLine("all participants vote yes:");
        TwoPhaseCommit(new() { new Participant("bankA", true), new Participant("bankB", true) });

        Console.WriteLine("one participant votes no:");
        TwoPhaseCommit(new() { new Participant("bankA", true), new Participant("bankB", false) });

        Console.WriteLine("coordinator crashes after the votes:");
        TwoPhaseCommit(new() { new Participant("bankA", true), new Participant("bankB", true) }, coordinatorCrashesAfterVotes: true);
    }
}

public class Participant(string name, bool canCommit)
{
    public string Name { get; } = name;
    public string State { get; private set; } = "idle";

    public bool Prepare()
    {
        // Do the work, write it to durable storage and lock the data; then promise to commit if asked
        State = canCommit ? "prepared (locks held)" : "aborted";
        return canCommit;
    }
    public void Commit() => State = "committed";
    public void Abort() => State = "aborted";
}
