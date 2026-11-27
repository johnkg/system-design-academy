// A promotion gate and a training run that resumes from a checkpoint, in C#.
// Scores are whole thousandths (800 means 0.800) so that every language prints the same numbers.
using System;
using System.Collections.Generic;

public static class Program
{
    private const int Margin = 20, Tolerance = 10; // promote only if overall gains at least 0.020 and no slice drops by more than 0.010
    private static readonly string[] Slices = { "short", "long", "non-english" };
    private static readonly Dictionary<string, int> Current = new() { ["overall"] = 800, ["short"] = 820, ["long"] = 760, ["non-english"] = 700 };

    private static string Fmt(int delta) => (delta < 0 ? "-" : "+") + "0." + Math.Abs(delta).ToString().PadLeft(3, '0');

    private static (bool Promoted, string Reason) Gate(Dictionary<string, int> candidate)
    {
        var gain = candidate["overall"] - Current["overall"];
        if (gain < Margin) return (false, $"overall {Fmt(gain)} below the margin");
        foreach (var name in Slices)
        {
            var delta = candidate[name] - Current[name];
            if (delta < -Tolerance) return (false, $"overall {Fmt(gain)} ok, slice {name} {Fmt(delta)} regressed");
        }
        return (true, $"overall {Fmt(gain)} ok, no slice regressed");
    }

    private const int TotalSteps = 10, CheckpointEvery = 4, CrashAfter = 7;
    private static readonly Dictionary<string, int> Storage = new(); // "latest" is the manifest

    private static void SaveCheckpoint(int step)
    {
        Storage[$"ckpt-{step}"] = step; // 1. write the data
        Storage["latest"] = step;       // 2. write the manifest last: a half-written checkpoint is never used
    }

    private static void Train(int first, int? crashAfter = null)
    {
        for (var step = first; step <= TotalSteps; step++)
        {
            if (step % CheckpointEvery == 0) SaveCheckpoint(step);
            if (step == crashAfter) throw new InvalidOperationException("node lost");
        }
    }

    public static void Main()
    {
        var candidates = new Dictionary<string, Dictionary<string, int>>
        {
            ["A"] = new() { ["overall"] = 840, ["short"] = 860, ["long"] = 800, ["non-english"] = 680 },
            ["B"] = new() { ["overall"] = 815, ["short"] = 830, ["long"] = 770, ["non-english"] = 705 },
            ["C"] = new() { ["overall"] = 850, ["short"] = 870, ["long"] = 810, ["non-english"] = 710 },
        };

        Console.WriteLine("gate: needs an overall gain of at least 0.020 and no slice down by more than 0.010");
        foreach (var (name, scores) in candidates)
        {
            var (promoted, reason) = Gate(scores);
            Console.WriteLine($"candidate {name}: {reason} -> {(promoted ? "promoted" : "rejected")}");
        }

        // A run that is interrupted resumes from its newest complete checkpoint.
        Console.WriteLine($"training {TotalSteps} steps, checkpoint every {CheckpointEvery}, crash after step {CrashAfter}");
        try
        {
            Train(1, CrashAfter);
        }
        catch (InvalidOperationException)
        {
            var saved = Storage["latest"];
            Console.WriteLine($"run 1: steps 1-{CrashAfter}, crashed, last checkpoint at step {saved}");
            Train(saved + 1);
            Console.WriteLine($"run 2: resumed at step {saved + 1}, finished at step {TotalSteps}");
            Console.WriteLine($"work redone: {CrashAfter - saved} steps");
        }
    }
}
