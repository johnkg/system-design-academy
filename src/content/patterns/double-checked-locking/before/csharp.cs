// Without the pattern: check, then create, with no lock. Every thread that arrives early builds its own.
using System;
using System.Linq;
using System.Threading;

public static class Program
{
    private static ExpensiveService? _instance;
    private static int _created;

    private class ExpensiveService
    {
        public ExpensiveService()
        {
            Thread.Sleep(50);
            Interlocked.Increment(ref _created);
        }
    }

    private static ExpensiveService GetInstance()
    {
        if (_instance == null) _instance = new ExpensiveService(); // several threads see null before the first one has finished
        return _instance;
    }

    public static void Main()
    {
        var threads = Enumerable.Range(0, 8).Select(_ => new Thread(() => GetInstance())).ToList();
        threads.ForEach(t => t.Start());
        threads.ForEach(t => t.Join());
        Console.WriteLine($"Instances created: {_created}"); // about 8, not 1
    }
}
