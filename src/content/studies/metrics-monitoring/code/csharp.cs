// Rollups and an alert rule with a "for" duration in C#:
// raw samples are squeezed into coarser buckets for long-term storage, and an alert only fires when a problem lasts.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

public record Sample(int T, double Value);

public static class Program
{
    // Turn many raw samples into one value per bucket, so months of history stay small.
    static List<Sample> Rollup(IEnumerable<Sample> samples, int bucketSeconds, Func<IEnumerable<double>, double> aggregate) =>
        samples.GroupBy(s => s.T / bucketSeconds * bucketSeconds)
               .OrderBy(g => g.Key)
               .Select(g => new Sample(g.Key, aggregate(g.Select(s => s.Value))))
               .ToList();

    // An alert rule is a small state machine: ok -> pending (condition true, but not for long enough yet) -> firing.
    static List<string> Evaluate(IEnumerable<Sample> samples, double threshold, int forSeconds)
    {
        string state = "ok"; int since = 0;
        var events = new List<string>();
        foreach (var s in samples)
        {
            if (s.Value > threshold)
            {
                if (state == "ok") { state = "pending"; since = s.T; }
                if (state == "pending" && s.T - since >= forSeconds) { state = "firing"; events.Add($"{s.T}s firing"); }
            }
            else
            {
                if (state == "firing") events.Add($"{s.T}s resolved");
                state = "ok";
            }
        }
        return events;
    }

    public static int Main()
    {
        // Ten minutes of CPU readings, one every 15 seconds: a one-sample spike at 60 s, and a real problem from 300 s to 420 s.
        var samples = Enumerable.Range(0, 40).Select(i =>
        {
            int t = i * 15;
            double value = t == 60 ? 97 : (t >= 300 && t <= 420) ? 90 : 40 + (i % 3) * 3;
            return new Sample(t, value);
        }).ToList();

        var minutes = Rollup(samples, 60, v => v.Max());
        Console.WriteLine($"{samples.Count} raw samples became {minutes.Count} one-minute points (max per minute)");
        Console.WriteLine($"hourly average CPU: {Rollup(samples, 3600, v => v.Average())[0].Value.ToString("0.0", CultureInfo.InvariantCulture)}");

        var noisy = Evaluate(samples, 80, 0);
        var calm = Evaluate(samples, 80, 60);
        Console.WriteLine($"alert without a duration: {string.Join(", ", noisy)}");
        Console.WriteLine($"alert that must last 60 s: {string.Join(", ", calm)}");
        return noisy.Count != 4 || calm.Count != 2 ? 1 : 0; // the spike alone must not page anyone, the real problem must
    }
}
