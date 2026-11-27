// Without the pattern: the logger may be null, so every use is guarded.
using System;

public static class Program
{
    public static void Main()
    {
        var withLogger = new OrderService(new ConsoleLogger());
        withLogger.Place(1);
        withLogger.Cancel(1);

        var withoutLogger = new OrderService(null);
        withoutLogger.Place(1);
        try { withoutLogger.Cancel(1); }
        catch (NullReferenceException) { Console.WriteLine("Crash: Cancel() used a logger that was null"); }
    }
}

public class ConsoleLogger
{
    public void Log(string message) => Console.WriteLine($"[log] {message}");
}

public class OrderService(ConsoleLogger? logger)
{
    private int _placed;

    public void Place(int id)
    {
        _placed++;
        if (logger != null) logger.Log($"placed order {id}"); // check
    }

    public void Cancel(int id)
    {
        _placed--;
        logger!.Log($"cancelled order {id}"); // someone forgot the check
    }
}
