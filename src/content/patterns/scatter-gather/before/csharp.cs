// Without the pattern: vendors are asked one after another, so the waiting times add up.
using System;

public static class Program
{
    public static void Main()
    {
        var vendors = new (string Name, int Latency, bool Fails)[]
        {
            ("A", 120, false), ("B", 80, false), ("C", 450, false), ("D", 200, false), ("E", 60, true),
        };

        var waited = 0;
        Console.WriteLine($"Asking {vendors.Length} vendors one by one");
        foreach (var v in vendors)
        {
            waited += v.Latency; // each call must finish before the next one starts
            Console.WriteLine($"  {v.Name} {(v.Fails ? "failed" : "answered")}, total waited {waited} ms");
        }
        Console.WriteLine($"Total wait: {waited} ms"); // the slow vendor C holds up everything after it
    }
}
