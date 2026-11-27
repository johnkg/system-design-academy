// Scatter-Gather in C#. Ask every vendor at once, then gather what arrives before the deadline.
// The clock is simulated (each vendor has a fixed answer time) so that the output is the same every run.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        var vendors = new List<Vendor>
        {
            new("A", 120, 105),
            new("B", 80, 99),
            new("C", 450, 90), // cheap, but too slow
            new("D", 200, 102),
            new("E", 60, null, "out of stock feed"),
        };

        var (name, price) = ScatterGather(vendors, 300);
        Console.WriteLine($"Best price: {price} ({name})");
    }

    private static (string Name, int Price) ScatterGather(List<Vendor> workers, int deadline)
    {
        Console.WriteLine($"Scatter: asking {workers.Count} vendors, deadline {deadline} ms");
        var gathered = new List<(string Name, int Price)>();
        foreach (var worker in workers.OrderBy(w => w.Latency)) // all were asked at time 0; Gatherer handles arrivals in order
        {
            if (worker.Latency > deadline)
            {
                Console.WriteLine($"  {worker.Name} too slow ({worker.Latency} ms), ignored");
                continue;
            }
            try
            {
                var price = worker.Ask();
                gathered.Add((worker.Name, price));
                Console.WriteLine($"  {worker.Name} answered in {worker.Latency} ms: {price}");
            }
            catch (InvalidOperationException error)
            {
                Console.WriteLine($"  {worker.Name} failed at {worker.Latency} ms: {error.Message}");
            }
        }
        Console.WriteLine($"Gathered {gathered.Count} of {workers.Count} answers");
        return gathered.MinBy(g => g.Price);
    }
}

public record Vendor(string Name, int Latency, int? Price, string? Error = null) // Worker
{
    public int Ask() => Error is null ? Price!.Value : throw new InvalidOperationException(Error); // answers or fails
}
