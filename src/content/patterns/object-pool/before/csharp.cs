// Without the pattern: every request opens its own connection.
using System;

public static class Program
{
    private static int _opened;

    // Slow, and the database allows only a few at once.
    private static int OpenConnection() => ++_opened;

    public static void Main()
    {
        foreach (var request in new[] { 1, 2, 3, 4 })
        {
            var id = OpenConnection();
            Console.WriteLine($"request {request} opens a new connection {id}");
        }
        Console.WriteLine($"Connections created: {_opened}"); // one per request: no reuse, no upper limit
    }
}
