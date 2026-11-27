// Double-checked locking in C#. Check without the lock, then lock, check again and create.
// In real C# code, prefer Lazy<T>; this shows what it saves you from writing.
using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Threading;

public static class Program
{
    public static void Main()
    {
        var results = new ConcurrentBag<ExpensiveService>();
        var threads = Enumerable.Range(0, 8).Select(_ => new Thread(() => results.Add(Holder.GetInstance()))).ToList();
        threads.ForEach(t => t.Start());
        threads.ForEach(t => t.Join());

        Console.WriteLine($"{threads.Count} callers asked for the instance");
        Console.WriteLine($"Instances created: {ExpensiveService.Created}");
        Console.WriteLine($"All callers got the same instance: {results.All(r => ReferenceEquals(r, results.First())).ToString().ToLower()}");
    }
}

public class ExpensiveService // Instance: slow to build
{
    private static int _created;
    public static int Created => _created;

    public ExpensiveService()
    {
        Thread.Sleep(50);
        Interlocked.Increment(ref _created);
    }
}

public static class Holder
{
    private static volatile ExpensiveService? _instance; // Instance field: volatile gives safe publication
    private static readonly object Gate = new(); // Lock

    public static ExpensiveService GetInstance()
    {
        if (_instance == null) // first check, no lock: the fast path once the object exists
        {
            lock (Gate)
            {
                if (_instance == null) // second check: another thread may have built it while we waited
                    _instance = new ExpensiveService();
            }
        }
        return _instance;
    }
}
