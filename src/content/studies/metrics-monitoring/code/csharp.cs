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

    const int Samples = 40;
    const int ScrapeS = 15; // seconds between readings
    const int SpikeAt = 60;
    const int SpikeCpu = 97;
    const int IncidentFrom = 300;
    const int IncidentTo = 420;
    const int IncidentCpu = 90;
    const int BaseCpu = 40; // normal load wobbles 40, 43, 46
    const int WobbleSteps = 3;
    const int WobblePct = 3;
    const int MinuteS = 60;
    const int HourS = 60 * MinuteS;
    const int Threshold = 80; // alert when CPU is above 80%
    const int AlertForS = 60; // for at least this long
    public static int Main()
    {
        // Ten minutes of CPU readings, one every 15 seconds: a one-sample spike at 60 s, and a real problem from 300 s to 420 s.
        var samples = Enumerable.Range(0, Samples).Select(i =>
        {
            int t = i * ScrapeS;
            double value = t == SpikeAt ? SpikeCpu : (t >= IncidentFrom && t <= IncidentTo) ? IncidentCpu : BaseCpu + (i % WobbleSteps) * WobblePct;
            return new Sample(t, value);
        }).ToList();

        var minutes = Rollup(samples, MinuteS, v => v.Max());
        Console.WriteLine($"{samples.Count} raw samples became {minutes.Count} one-minute points (max per minute)");
        Console.WriteLine($"hourly average CPU: {Rollup(samples, HourS, v => v.Average())[0].Value.ToString("0.0", CultureInfo.InvariantCulture)}");

        var noisy = Evaluate(samples, Threshold, 0);
        var calm = Evaluate(samples, Threshold, AlertForS);
        Console.WriteLine($"alert without a duration: {string.Join(", ", noisy)}");
        Console.WriteLine($"alert that must last 60 s: {string.Join(", ", calm)}");
        return noisy.Count != 4 || calm.Count != 2 ? 1 : 0; // the spike alone must not page anyone, the real problem must
    }
}
