// Without the pattern: callers run the method themselves, and each one waits for it to finish.
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        var calculator = new Calculator();
        Console.WriteLine($"add(2, 3) = {calculator.Add(2, 3)}");
        Console.WriteLine($"add(10, 5) = {calculator.Add(10, 5)}");
        Console.WriteLine($"history() = {calculator.History()}");
    }
}

public class Calculator
{
    private readonly List<int> _history = new();
    private readonly object _gate = new(); // needed as soon as two threads call Add()

    public int Add(int a, int b)
    {
        lock (_gate) // every caller waits here for its turn
        {
            var result = a + b;
            _history.Add(result);
            return result;
        }
    }

    public string History()
    {
        lock (_gate) return string.Join(", ", _history);
    }
}
