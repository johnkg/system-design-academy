// Null Object in C#. A missing logger is a logger that does nothing.
using System;

public static class Program
{
    public static void Main()
    {
        Console.WriteLine("With a logger:");
        var withLogger = new OrderService(LoggerFor(true));
        withLogger.Place(1);
        withLogger.Place(2);
        Console.WriteLine($"Placed {withLogger.Placed} orders");

        Console.WriteLine("Without a logger:");
        var withoutLogger = new OrderService(LoggerFor(false));
        withoutLogger.Place(1);
        withoutLogger.Place(2);
        Console.WriteLine($"Placed {withoutLogger.Placed} orders");
    }

    // The one place that decides what a missing logger means.
    private static ILogger LoggerFor(bool logging) => logging ? new ConsoleLogger() : new NullLogger();
}

public interface ILogger // Abstract object
{
    void Log(string message);
}

public class ConsoleLogger : ILogger // Real object
{
    public void Log(string message) => Console.WriteLine($"[log] {message}");
}

public class NullLogger : ILogger // Null object: same interface, no behaviour
{
    public void Log(string message) { }
}

public class OrderService(ILogger logger) // Client: never checks whether the logger is real
{
    public int Placed { get; private set; }

    public void Place(int id)
    {
        Placed++;
        logger.Log($"placed order {id}");
    }
}
