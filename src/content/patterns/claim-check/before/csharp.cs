// Without the pattern: the whole payload travels inside the queue message.
using System;

public static class Program
{
    private const int QueueLimitKb = 256;

    private static string Send(int sizeKb)
    {
        if (sizeKb > QueueLimitKb) throw new InvalidOperationException("message too large");
        return "sent";
    }

    public static void Main()
    {
        const int videoKb = 20000;
        Console.WriteLine($"Message size: {videoKb} KB, queue limit: {QueueLimitKb} KB");
        try { Send(videoKb); }
        catch (InvalidOperationException error) { Console.WriteLine($"Rejected: {error.Message}"); }
        // Even where a queue allows it, every hop and every consumer copies all 20000 KB.
    }
}
