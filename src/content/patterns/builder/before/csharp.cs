// Without the pattern: a long positional constructor.
using System;

public static class Program
{
    public static void Main()
    {
        // What do these mean? Which boolean is which? Callers must pass everything.
        var a = new Pizza("large", "thick", true, new[] { "ham", "olives" }, true, false);
        var b = new Pizza("medium", "thin", true, new[] { "mozzarella", "basil" }, false, false);
        Console.WriteLine($"{Show(a)} {Show(b)}");
        // Adding "stuffedCrust" later means a seventh positional argument (or another overload) to keep in order.
    }

    // Formats the object like the JavaScript console.log does.
    static string Show(Pizza p) =>
        "Pizza {\n" +
        $"  size: '{p.Size}',\n" +
        $"  crust: '{p.Crust}',\n" +
        $"  hasCheese: {(p.HasCheese ? "true" : "false")},\n" +
        $"  toppings: [ {string.Join(", ", Array.ConvertAll(p.Toppings, t => $"'{t}'"))} ],\n" +
        $"  extraSauce: {(p.ExtraSauce ? "true" : "false")},\n" +
        $"  glutenFree: {(p.GlutenFree ? "true" : "false")}\n" +
        "}";
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
