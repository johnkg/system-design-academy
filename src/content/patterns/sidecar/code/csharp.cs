// Sidecar in C#. The app has no networking code: a helper beside it adds logging and retries.
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        new PaymentsService(new Sidecar()).Run(); // each instance gets its own sidecar
        new OrdersService(new Sidecar()).Run();
    }
}

public static class Network // stand-in for the real network: the first attempt always times out
{
    private static readonly Dictionary<string, string> Replies = new() { ["fraud-check"] = "clear", ["catalog"] = "in stock" };

    public static string Call(string target, int attempt)
    {
        if (attempt == 1) throw new TimeoutException("timeout");
        return Replies[target];
    }
}

public class Sidecar // Runs beside the app; the app talks to it as if it were the network
{
    private int _count;

    public string Send(string target, int attempts = 3)
    {
        var id = $"r-{++_count}";
        Console.WriteLine($"[sidecar] request {id} to {target}");
        for (var attempt = 1; attempt <= attempts; attempt++)
        {
            try
            {
                var reply = Network.Call(target, attempt);
                Console.WriteLine($"[sidecar] attempt {attempt} ok");
                return reply;
            }
            catch (TimeoutException error)
            {
                Console.WriteLine($"[sidecar] attempt {attempt} failed: {error.Message}");
            }
        }
        throw new InvalidOperationException($"{target} unavailable");
    }
}

public class PaymentsService(Sidecar sidecar) // Application: business logic only
{
    public void Run() => Console.WriteLine($"payments: fraud-check answered \"{sidecar.Send("fraud-check")}\"");
}

public class OrdersService(Sidecar sidecar)
{
    public void Run() => Console.WriteLine($"orders: catalog answered \"{sidecar.Send("catalog")}\"");
}
