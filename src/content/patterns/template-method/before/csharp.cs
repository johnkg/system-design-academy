// Without the pattern: each drink copies the whole recipe.
using System;

public static class Program
{
    public static void Main()
    {
        new Tea().Prepare();
        Console.WriteLine("---");
        new Coffee().Prepare();
    }
}

public class Tea
{
    public void Prepare()
    {
        Console.WriteLine("Boiling water");
        Console.WriteLine("Steeping the tea bag");
        Console.WriteLine("Pouring into cup");
        Console.WriteLine("Adding lemon");
    }
}

public class Coffee
{
    public void Prepare()
    {
        Console.WriteLine("Boiling water");                       // copied
        Console.WriteLine("Dripping coffee through the filter");
        Console.WriteLine("Pouring into cup");                     // copied
        // someone forgot the condiments step here, and nothing complains
    }
}
// Change the shared "boil water" step? Edit every class. The order can drift silently.
