// Without the pattern: every change is written the moment it is made.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    private static readonly Dictionary<string, string> Store = new();

    public static void Main()
    {
        try { Checkout(); }
        catch (InvalidOperationException error) { Console.WriteLine($"Checkout failed: {error.Message}"); }
        Console.WriteLine($"Store: {Show()}"); // a paid order and lower stock, with no points
    }

    private static void Write(string key, string value)
    {
        if (key.StartsWith("points:") && !value.All(char.IsDigit)) throw new InvalidOperationException("points must be a number");
        Store[key] = value;
    }

    private static string Show() =>
        string.Join(", ", Store.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => $"{p.Key}={p.Value}"));

    private static void Checkout()
    {
        Write("order:2", "paid");
        Write("stock:apple", "8");
        Write("points:ada", "lots"); // fails here: the first two writes are already saved
    }
}
