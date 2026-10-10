// Event sourcing in C#: state is derived from an append-only list of events.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        var account = new Account();
        account.Deposit(100);
        account.Withdraw(30);
        account.Deposit(50);
        Console.WriteLine("balance: " + account.Balance);
        Console.WriteLine("events: " + string.Join(", ", account.Events.Select(e => $"{e.Type} {e.Amount}")));

        try { account.Withdraw(500); } catch (InvalidOperationException e) { Console.WriteLine("rejected: " + e.Message); } // no event is recorded

        Console.WriteLine("rebuilt from events: " + Account.Rebuild(account.Events).Balance);
        Console.WriteLine("balance after 2 events: " + Account.Rebuild(account.Events.Take(2).ToList()).Balance); // time travel

        var snapshot = (Balance: 70m, Version: 2); // state saved at event 2
        Console.WriteLine($"from snapshot (balance 70 at event 2) + 1 later event: {Account.Rebuild(account.Events, snapshot).Balance}");
    }
}

public record AccountEvent(string Type, decimal Amount);

public class Account
{
    private List<AccountEvent> _events = new();
    public decimal Balance { get; private set; }

    public static Account Rebuild(IReadOnlyList<AccountEvent> events, (decimal Balance, int Version)? from = null) // replay on top of a snapshot
    {
        var account = new Account();
        var (balance, version) = from ?? (0m, 0);
        account.Balance = balance;
        account._events = events.Take(version).ToList();
        foreach (var e in events.Skip(version)) account.Record(e);
        return account;
    }

    public void Deposit(decimal amount) => Record(new AccountEvent("Deposited", amount));

    public void Withdraw(decimal amount) // a command is validated against current state before an event is recorded
    {
        if (amount > Balance) throw new InvalidOperationException("insufficient funds");
        Record(new AccountEvent("Withdrawn", amount));
    }

    public IReadOnlyList<AccountEvent> Events => _events.AsReadOnly(); // callers cannot modify history

    private void Record(AccountEvent e)
    {
        _events.Add(e);
        Balance += e.Type == "Deposited" ? e.Amount : -e.Amount;
    }
}
