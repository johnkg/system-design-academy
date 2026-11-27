// Object Pool in C#. Connections are created on demand up to a limit, then reused.
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        var pool = new Pool(3);
        var held = new Dictionary<int, Connection>();

        foreach (var request in new[] { 1, 2, 3, 4 })
        {
            var got = pool.Acquire();
            if (got is null)
            {
                Console.WriteLine($"request {request} must wait: all {pool.Size} connections busy");
                continue;
            }
            held[request] = got.Value.Conn;
            Console.WriteLine($"request {request} uses connection {got.Value.Conn.Id} ({got.Value.How})");
        }

        pool.Release(held[1]);
        Console.WriteLine($"request 1 done, connection {held[1].Id} returned (reset)");

        var again = pool.Acquire()!.Value;
        Console.WriteLine($"request 4 uses connection {again.Conn.Id} ({again.How})");
        Console.WriteLine($"Connections created: {pool.Created}");
    }
}

public class Connection(int id) // Pooled object
{
    public int Id { get; } = id;
    public void Reset() { /* clear session state so the next borrower starts clean */ }
}

public class Pool(int size)
{
    private readonly Stack<Connection> _free = new();
    public int Size { get; } = size;
    public int Created { get; private set; }

    public (Connection Conn, string How)? Acquire() // null when every connection is busy
    {
        if (_free.Count > 0) return (_free.Pop(), "reused");
        if (Created >= Size) return null;
        Created++;
        return (new Connection(Created), "created");
    }

    public void Release(Connection conn)
    {
        conn.Reset();
        _free.Push(conn);
    }
}
