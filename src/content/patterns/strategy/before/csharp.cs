// Without the pattern: one method, one branch per discount rule.
using System;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        var checkout = new Checkout();
        decimal[] cart = { 30m, 20m };
        Console.WriteLine(checkout.Total(cart, "regular"));
        Console.WriteLine(checkout.Total(cart, "percent20"));
        Console.WriteLine(checkout.Total(cart, "flat15"));
    }
}

public class Checkout
{
    public decimal Total(decimal[] prices, string kind)
    {
        decimal sum = prices.Sum();
        if (kind == "percent20") return sum * 0.8m;
        if (kind == "flat15") return Math.Max(0, sum - 15);
        // Every new promotion adds another branch right here.
        return sum;
    }
}
