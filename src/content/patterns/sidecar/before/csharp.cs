// Without the pattern: every service carries its own copy of the retry and logging code.
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        new PaymentsService().Run();
        new OrdersService().Run();
    }
}

public static class Network
{
    private static readonly Dictionary<string, string> Replies = new() { ["fraud-check"] = "clear", ["catalog"] = "in stock" };

    public static string Call(string target, int attempt)
    {
        if (attempt == 1) throw new TimeoutException("timeout");
        return Replies[target];
    }
}

public class PaymentsService
{
    private static string? Call(string target) // copy 1 of the retry loop
    {
        for (var attempt = 1; attempt <= 3; attempt++)
        {
            try { return Network.Call(target, attempt); }
            catch (TimeoutException error) { Console.WriteLine($"[payments] attempt {attempt} failed: {error.Message}"); }
        }
        return null;
    }

    public void Run() => Console.WriteLine($"payments: fraud-check answered \"{Call("fraud-check")}\"");
}

public class OrdersService
{
    private static string? Call(string target) // copy 2: written separately, and already different (two attempts, no log line)
    {
        for (var attempt = 1; attempt <= 2; attempt++)
        {
            try { return Network.Call(target, attempt); }
            catch (TimeoutException) { /* retry */ }
        }
        return null;
    }

    public void Run() => Console.WriteLine($"orders: catalog answered \"{Call("catalog")}\"");
}
