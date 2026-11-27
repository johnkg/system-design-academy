// Active Object in C#. Calls become queued requests, run one at a time by a single worker thread.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

public static class Program
{
    public static void Main()
    {
        var calculator = new ActiveCalculator(new Calculator());

        var first = calculator.Add(2, 3);
        Console.WriteLine("submitted add(2, 3)");
        var second = calculator.Add(10, 5);
        Console.WriteLine("submitted add(10, 5)");
        var history = calculator.History();
        Console.WriteLine("submitted history()");

        Console.WriteLine($"add(2, 3) = {first.Result}");
        Console.WriteLine($"add(10, 5) = {second.Result}");
        Console.WriteLine($"history() = {history.Result}");
        calculator.Stop();
        Console.WriteLine($"Servant ran {calculator.Ran} requests on one worker");
    }
}

public class Calculator // Servant: a plain class, only ever called by the worker thread
{
    private readonly List<int> _history = new();

    public int Add(int a, int b)
    {
        var result = a + b;
        _history.Add(result);
        return result;
    }

    public string History() => string.Join(", ", _history);
}

public class ActiveCalculator // Proxy and scheduler: callers get a Task (the future) straight away
{
    private readonly Calculator _servant;
    private readonly BlockingCollection<Action> _queue = new();
    private readonly Thread _worker;
    public int Ran { get; private set; }

    public ActiveCalculator(Calculator servant)
    {
        _servant = servant;
        _worker = new Thread(() =>
        {
            foreach (var request in _queue.GetConsumingEnumerable()) // one request at a time, in submission order
            {
                request();
                Ran++;
            }
        });
        _worker.Start();
    }

    public Task<int> Add(int a, int b) => Enqueue(() => _servant.Add(a, b));
    public Task<string> History() => Enqueue(_servant.History);

    private Task<T> Enqueue<T>(Func<T> call)
    {
        var done = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        _queue.Add(() =>
        {
            try { done.SetResult(call()); }
            catch (Exception error) { done.SetException(error); }
        });
        return done.Task;
    }

    public void Stop()
    {
        _queue.CompleteAdding();
        _worker.Join();
    }
}
