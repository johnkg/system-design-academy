// Scaled dot-product attention in C#, for three tokens with a causal mask.
using System;
using System.Globalization;
using System.Linq;

public static class Program
{
    private static string F(double x) => x.ToString("F3", CultureInfo.InvariantCulture);

    public static void Main()
    {
        string[] names = { "the", "trophy", "it" };
        double[][] queries = { new double[] { 1, 0 }, new double[] { 0, 1 }, new double[] { 0, 2 } };     // what each token is looking for
        double[][] keys = { new double[] { 1, 0 }, new double[] { 0, 1 }, new double[] { 0.5, 0.5 } };    // what each token offers
        double[][] values = { new double[] { 1, 0 }, new double[] { 0, 2 }, new double[] { 3, 3 } };      // what each token passes on
        const int d = 2;                                                                                   // size of a key

        var scores = new double[names.Length][];
        var weights = new double[names.Length][];
        var outputs = new double[names.Length][];
        for (var i = 0; i < names.Length; i++)
        {
            var row = Enumerable.Range(0, i + 1) // causal: only j <= i
                .Select(j => queries[i].Zip(keys[j], (q, k) => q * k).Sum() / Math.Sqrt(d)).ToArray();
            var peak = row.Max();
            var exps = row.Select(s => Math.Exp(s - peak)).ToArray();
            var total = exps.Sum();
            var w = exps.Select(e => e / total).ToArray(); // softmax: weights that add up to 1
            scores[i] = row;
            weights[i] = w;
            outputs[i] = new[] { 0, 1 }.Select(c => Enumerable.Range(0, i + 1).Sum(j => w[j] * values[j][c])).ToArray();
        }

        Console.WriteLine("scores (row = token asking, column = token it can look at):");
        for (var i = 0; i < names.Length; i++) Console.WriteLine($"{names[i] + ":",-8}" + string.Join(" ", scores[i].Select(F)));
        Console.WriteLine("weights (each row adds up to 1):");
        for (var i = 0; i < names.Length; i++) Console.WriteLine($"{names[i] + ":",-8}" + string.Join(" ", weights[i].Select(F)));
        Console.WriteLine("outputs (weighted mix of the value vectors):");
        for (var i = 0; i < names.Length; i++) Console.WriteLine($"{names[i] + ":",-8}[{F(outputs[i][0])}, {F(outputs[i][1])}]");
    }
}
