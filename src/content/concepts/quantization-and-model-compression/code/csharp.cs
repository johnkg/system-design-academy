// 8-bit quantization in C#: round each weight to an integer from -127 to 127, then convert back.
using System;
using System.Globalization;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        double[] weights = { 0.12, -0.5, 0.33, 0.9, -0.77, 0.05 };

        var scale = weights.Max(Math.Abs) / 127; // the largest weight maps to 127
        var quantized = weights.Select(w => (int)Math.Round(w / scale, MidpointRounding.AwayFromZero)).ToArray();
        var restored = quantized.Select(q => q * scale).ToArray();
        var largestError = weights.Select((w, i) => Math.Abs(w - restored[i])).Max();

        string F(double x, int d) => x.ToString("F" + d, CultureInfo.InvariantCulture);
        Console.WriteLine($"scale: {F(scale, 5)}");
        Console.WriteLine("int8 values: " + string.Join(", ", quantized));
        Console.WriteLine("restored:    " + string.Join(", ", restored.Select(r => F(r, 4))));
        Console.WriteLine($"largest error: {F(largestError, 4)}");
        Console.WriteLine($"memory: {weights.Length * 2} bytes as 16-bit, {weights.Length} bytes as int8 (plus one scale)");
    }
}
