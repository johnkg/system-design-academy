// Reactor in C#. One loop asks which connections are ready and dispatches each to its handler.
// The demultiplexer is simulated with fixed batches so that the output is the same on every run;
// real servers use the operating system's event notification (.NET sockets do this for you).
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        var selector = new Selector(new()
        {
            new() { ("conn-2", "hello"), ("conn-1", "ping") },
            new() { ("conn-3", "bye") },
        });
        var reactor = new Reactor(selector);
        reactor.Register("conn-1", data => data.ToUpper()); // Event handlers
        reactor.Register("conn-2", data => data.ToUpper());
        reactor.Register("conn-3", data => data == "bye" ? "goodbye" : "hello");
        Console.WriteLine($"reactor: {reactor.Size} connections registered");
        reactor.Run();
    }
}

public class Selector(List<List<(string Connection, string Data)>> batches) // Event demultiplexer
{
    private readonly Queue<List<(string Connection, string Data)>> _batches = new(batches);

    public List<(string Connection, string Data)>? Select() => _batches.Count > 0 ? _batches.Dequeue() : null;
}

public class Reactor(Selector selector)
{
    private readonly Dictionary<string, Func<string, string>> _handlers = new();

    public void Register(string connection, Func<string, string> handler) => _handlers[connection] = handler;
    public int Size => _handlers.Count;

    public void Run()
    {
        var batchNumber = 0;
        for (var ready = selector.Select(); ready is not null; ready = selector.Select())
        {
            batchNumber++;
            Console.WriteLine($"batch {batchNumber}: {ready.Count} ready");
            foreach (var (connection, data) in ready) // dispatch: each handler is quick and does not block
            {
                var reply = _handlers[connection](data);
                Console.WriteLine($"  {connection} got \"{data}\" -> \"{reply}\"");
            }
        }
        Console.WriteLine("reactor: no more events, loop ends");
    }
}
