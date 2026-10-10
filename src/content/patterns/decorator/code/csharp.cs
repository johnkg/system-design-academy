// Decorator in C#. Each add-on wraps another IBeverage.
using System;

public static class Program
{
    public static void Main()
    {
        IBeverage drink = new Espresso();
        drink = new Milk(drink);
        drink = new Mocha(drink);
        drink = new Mocha(drink); // double mocha: just wrap again
        drink = new Whip(drink);

        Console.WriteLine($"{drink.Description} = ${drink.Cost:F2}");
        // Espresso, milk, mocha, mocha, whip = $4.30
    }
}

public interface IBeverage // Component
{
    string Description { get; }
    decimal Cost { get; }
}

public class Espresso : IBeverage // Concrete Component
{
    public string Description => "Espresso";
    public decimal Cost => 2.0m;
}

public abstract class AddOn(IBeverage beverage) : IBeverage // Decorator
{
    protected IBeverage Beverage { get; } = beverage;
    public virtual string Description => Beverage.Description;
    public virtual decimal Cost => Beverage.Cost;
}

public class Milk(IBeverage beverage) : AddOn(beverage) // Concrete Decorator
{
    public override string Description => $"{Beverage.Description}, milk";
    public override decimal Cost => Beverage.Cost + 0.5m;
}

public class Mocha(IBeverage beverage) : AddOn(beverage) // Concrete Decorator
{
    public override string Description => $"{Beverage.Description}, mocha";
    public override decimal Cost => Beverage.Cost + 0.7m;
}

public class Whip(IBeverage beverage) : AddOn(beverage) // Concrete Decorator
{
    public override string Description => $"{Beverage.Description}, whip";
    public override decimal Cost => Beverage.Cost + 0.4m;
}
