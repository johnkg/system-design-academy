// Temperature and top-p in C#, on fixed scores so that the output is the same every run.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

public static class Program
{
    private static string F(double x) => x.ToString("F3", CultureInfo.InvariantCulture);

    private static double[] Softmax(double[] logits, double temperature)
    {
        var exps = logits.Select(x => Math.Exp(x / temperature)).ToArray();
        var total = exps.Sum();
        return exps.Select(e => e / total).ToArray();
    }

    public static void Main()
    {
        string[] tokens = { "a", "b", "c", "d", "e" };
        double[] logits = { 4, 3, 2, 1, 0 };

        foreach (var temperature in new double[] { 0.5, 1, 2 })
        {
            var p = Softmax(logits, temperature);
            Console.WriteLine($"temperature {temperature.ToString(CultureInfo.InvariantCulture)}: " + string.Join(", ", tokens.Select((t, i) => $"{t} {F(p[i])}")));
        }

        var probs = Softmax(logits, 1);
        var order = Enumerable.Range(0, tokens.Length).OrderByDescending(i => probs[i]); // most likely first
        var kept = new List<int>();
        var total = 0.0;
        foreach (var i in order) // top-p: the smallest set whose probabilities add up to at least p
        {
            kept.Add(i);
            total += probs[i];
            if (total >= 0.9) break;
        }
        Console.WriteLine($"top-p 0.9 at temperature 1 keeps {string.Join(", ", kept.Select(i => tokens[i]))} (together {F(total)})");
        Console.WriteLine("renormalised: " + string.Join(", ", kept.Select(i => $"{tokens[i]} {F(probs[i] / total)}")));
    }
}
