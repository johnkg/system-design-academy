// Latency metrics in C#: why the average hides the slow tail, and how percentiles reveal it.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    // Nearest-rank percentile: the smallest value that at least p% of the observations do not exceed
    static int Percentile(List<int> sorted, int p)
    {
        var rank = (int)Math.Ceiling(p / 100.0 * sorted.Count);
        return sorted[rank - 1];
    }

    public static void Main()
    {
        // 98 ordinary requests between 80 and 120 ms, plus two very slow ones
        const int OrdinaryRequests = 98, MinMs = 80, SpreadMs = 41;
        const int ScatterStep = 37; // coprime with SpreadMs, so the values scatter over the range
        var latencies = new List<int>();
        for (var i = 1; i <= OrdinaryRequests; i++) latencies.Add(MinMs + (i * ScatterStep) % SpreadMs);
        latencies.Add(2400);
        latencies.Add(2900);

        var sorted = latencies.OrderBy(x => x).ToList();
        var mean = latencies.Average();

        Console.WriteLine($"requests: {latencies.Count}");
        Console.WriteLine($"mean: {mean:F1} ms   <- looks fine");
        Console.WriteLine($"p50:  {Percentile(sorted, 50)} ms");
        Console.WriteLine($"p95:  {Percentile(sorted, 95)} ms");
        Console.WriteLine($"p99:  {Percentile(sorted, 99)} ms   <- what 1 request in 100 experiences");

        // A histogram keeps only a count per bucket, which is how metrics systems store latency cheaply
        var bounds = new[] { 100, 250, 1000, int.MaxValue };
        var counts = new int[bounds.Length];
        foreach (var value in latencies) counts[Array.FindIndex(bounds, limit => value <= limit)]++;
        Console.WriteLine("histogram: " + string.Join("  ", bounds.Select((limit, i) => $"<={(limit == int.MaxValue ? "inf" : limit.ToString())}: {counts[i]}")));
    }
}
