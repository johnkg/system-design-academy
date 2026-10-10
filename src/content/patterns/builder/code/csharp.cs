// Builder in C#. Fluent builder, defaults, and validation in Build().
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        var custom = new PizzaBuilder().Size("large").Crust("thick")
            .AddTopping("ham").AddTopping("olives").ExtraSauce().Build();
        Console.WriteLine(custom.Describe());
        Console.WriteLine(PizzaMenu.Margherita(new PizzaBuilder()).Describe());
    }
}

public record Pizza(string Size, string Crust, IReadOnlyList<string> Toppings, bool ExtraSauce) // Product
{
    public string Describe() =>
        $"{Size} {Crust} pizza with {(Toppings.Count == 0 ? "no toppings" : string.Join(", ", Toppings))}{(ExtraSauce ? ", extra sauce" : "")}";
}

public class PizzaBuilder // Builder
{
    private string _size = "medium";
    private string _crust = "thin";
    private readonly List<string> _toppings = new();
    private bool _extraSauce;

    public PizzaBuilder Size(string value) { _size = value; return this; }
    public PizzaBuilder Crust(string value) { _crust = value; return this; }
    public PizzaBuilder AddTopping(string name) { _toppings.Add(name); return this; }
    public PizzaBuilder ExtraSauce() { _extraSauce = true; return this; }

    public Pizza Build()
    {
        if (_toppings.Count > 4) throw new InvalidOperationException("Too many toppings (max 4)");
        return new Pizza(_size, _crust, _toppings.ToArray(), _extraSauce);
    }
}

public static class PizzaMenu // Director: stores recipes
{
    public static Pizza Margherita(PizzaBuilder b) =>
        b.Size("medium").AddTopping("mozzarella").AddTopping("basil").Build();
}
