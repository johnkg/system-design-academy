// Training-serving skew in C#: one feature, days since signup, computed in two places.
using System;

public static class Program
{
    private static int TrainingDays(int signup, int now) => (now - signup) / 24; // the batch pipeline counts whole days
    private static int ServingDays(int signup, int now) => (now - signup + 23) / 24; // the live service rounds up

    public static void Main()
    {
        var pairs = new[] { (0, 48), (0, 50), (10, 130), (5, 100), (0, 24) }; // (signup hour, now hour)
        var mismatches = 0;
        foreach (var (signup, now) in pairs)
        {
            var train = TrainingDays(signup, now);
            var serve = ServingDays(signup, now);
            var differ = train != serve;
            if (differ) mismatches++;
            Console.WriteLine($"signup {signup}h, now {now}h: training {train}, serving {serve}, {(differ ? "MISMATCH" : "match")}");
        }
        Console.WriteLine($"mismatches: {mismatches} of {pairs.Length} ({mismatches * 100 / pairs.Length}%)");
    }
}
