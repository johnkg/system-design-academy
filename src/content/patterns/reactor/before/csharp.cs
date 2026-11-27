// Without the pattern: one thread per connection, each blocked on its own reads.
// (Modelled by counting: a real thread-per-connection server would block in Read() on each of these.)
using System;

public static class Program
{
    public static void Main()
    {
        foreach (var connections in new[] { 3, 10000 })
        {
            var threads = connections; // one blocked thread for every connection, busy or idle
            Console.WriteLine($"{connections} connections need {threads} threads");
        }
        // Most of those threads are asleep, waiting for a message that may not come for minutes.
    }
}
