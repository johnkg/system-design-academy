// Without the pattern: a long positional constructor.
using System;

public static class Program
{
    public static void Main()
    {
        // What do these mean? Which boolean is which? Callers must pass everything.
        var a = new Pizza("large", "thick", true, new[] { "ham", "olives" }, true, false);
        var b = new Pizza("medium", "thin", true, new[] { "mozzarella", "basil" }, false, false);
        Console.WriteLine($"{a.Size}, {b.Size}");
        // Adding "stuffedCrust" later means a seventh argument at every call site.
    }
}

public class Pizza(string size, string crust, bool hasCheese, string[] toppings, bool extraSauce, bool glutenFree)
{
    public string Size { get; } = size;
    public string Crust { get; } = crust;
    public bool HasCheese { get; } = hasCheese;
    public string[] Toppings { get; } = toppings;
    public bool ExtraSauce { get; } = extraSauce;
    public bool GlutenFree { get; } = glutenFree;
}
