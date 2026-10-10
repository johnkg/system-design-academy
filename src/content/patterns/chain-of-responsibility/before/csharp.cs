// Without the pattern: one method knows every approver and every limit.
using System;

public static class Program
{
    public static void Main()
    {
        Console.WriteLine(Approve(500));
        Console.WriteLine(Approve(5_000));
        Console.WriteLine(Approve(50_000));
    }

    static string Approve(decimal amount)
    {
        if (amount <= 1_000) return $"Manager approves ${amount}";
        else if (amount <= 10_000) return $"Director approves ${amount}";
        else return $"CEO approves ${amount}";
        // Add a VP at $5,000? Edit this method. Skip the Director on holiday? Edit it again.
    }
}
