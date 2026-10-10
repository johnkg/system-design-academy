// Strategy in C#. Classic interface version; Func<decimal, decimal> works too.
using System;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        decimal[] cart = { 30m, 20m };
        var checkout = new Checkout(new RegularPrice());
        Console.WriteLine(checkout.Total(cart)); // 50

        checkout.Strategy = new PercentOff(20);  // swap at runtime
        Console.WriteLine(checkout.Total(cart)); // 40

        checkout.Strategy = new FlatOff(15);
        Console.WriteLine(checkout.Total(cart)); // 35
    }
}

public interface IDiscountStrategy // Strategy
{
    decimal Apply(decimal total);
}

public class RegularPrice : IDiscountStrategy // Concrete Strategy
{
    public decimal Apply(decimal total) => total;
}

public class PercentOff(decimal percent) : IDiscountStrategy // Concrete Strategy
{
    public decimal Apply(decimal total) => total * (1 - percent / 100);
}

public class FlatOff(decimal amount) : IDiscountStrategy // Concrete Strategy
{
    public decimal Apply(decimal total) => Math.Max(0, total - amount);
}

public class Checkout(IDiscountStrategy strategy) // Context
{
    public IDiscountStrategy Strategy { get; set; } = strategy;

    public decimal Total(decimal[] prices) =>
        Strategy.Apply(prices.Sum()); // delegate; Checkout never knows which rule runs
}
