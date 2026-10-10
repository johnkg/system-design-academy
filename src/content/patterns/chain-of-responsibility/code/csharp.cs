// Chain of Responsibility in C#. Each approver handles or passes on.
using System;

public static class Program
{
    public static void Main()
    {
        var manager = new Approver("Manager", 1_000);   // Concrete Handlers
        var director = new Approver("Director", 10_000);
        var ceo = new Approver("CEO", decimal.MaxValue);
        manager.SetNext(director).SetNext(ceo);

        Console.WriteLine(manager.Approve(500));     // Manager approves $500
        Console.WriteLine(manager.Approve(5_000));   // Director approves $5000
        Console.WriteLine(manager.Approve(50_000));  // CEO approves $50000
    }
}

public class Approver(string name, decimal limit) // Handler
{
    private Approver? _next;

    public Approver SetNext(Approver next) { _next = next; return next; } // returns next so calls chain

    public string Approve(decimal amount)
    {
        if (amount <= limit) return $"{name} approves ${amount}";
        if (_next is not null) return _next.Approve(amount); // pass it on
        return $"No one can approve ${amount}";
    }
}
