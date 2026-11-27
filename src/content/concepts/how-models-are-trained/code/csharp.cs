// Gradient descent in C# on the loss (w - 3)^2: the weight w should end up at 3.
using System;
using System.Globalization;

public static class Program
{
    private static string F(double x) => x.ToString("F4", CultureInfo.InvariantCulture);
    private static double Loss(double x) => Math.Pow(x - 3, 2);

    public static void Main()
    {
        const double learningRate = 0.1;
        var w = 0.0;

        Console.WriteLine($"step 0: w={F(w)}, loss={F(Loss(w))}");
        for (var step = 1; step <= 5; step++)
        {
            var gradient = 2 * (w - 3); // how the loss changes if w changes a little
            w -= learningRate * gradient; // move against the gradient
            Console.WriteLine($"step {step}: w={F(w)}, loss={F(Loss(w))}");
        }
    }
}
