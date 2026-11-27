// Compute-optimal model size in C#, using C = 6 * N * D and D = 20 * N, so N = sqrt(C / 120).
using System;
using System.Globalization;

public static class Program
{
    private static string F1(double x) => x.ToString("F1", CultureInfo.InvariantCulture);

    public static void Main()
    {
        const double tokensPerParameter = 20;

        foreach (var (compute, label) in new[] { (1e21, "1e+21"), (1e23, "1e+23"), (1e25, "1e+25") })
        {
            var parameters = Math.Sqrt(compute / (6 * tokensPerParameter));
            var tokens = tokensPerParameter * parameters;
            Console.WriteLine($"compute {label} FLOPs: {F1(parameters / 1e9)} billion parameters, {F1(tokens / 1e9)} billion tokens");
        }

        // Check against a published run: 70 billion parameters, 1.4 trillion tokens.
        var chinchilla = 6 * 70e9 * 1.4e12;
        Console.WriteLine($"6 x 70 billion x 1.4 trillion = {F1(chinchilla / 1e21)} x 1e21 FLOPs, {F1(1.4e12 / 70e9)} tokens per parameter");
    }
}
