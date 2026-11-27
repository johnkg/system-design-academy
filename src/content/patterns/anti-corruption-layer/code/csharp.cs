// Anti-Corruption Layer in C#. Billing only ever sees clean Customers, never the CRM's records.
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        var billing = new BillingService(new CustomerGateway(new LegacyCrm()));
        foreach (var id in new[] { 1, 2, 3 }) billing.Describe(id);
    }
}

public record LegacyRecord(string CUST_NM, string STAT_CD, string BAL_AMT); // what the old CRM returns

public class LegacyCrm
{
    private readonly Dictionary<int, LegacyRecord> _records = new()
    {
        [1] = new("LOVELACE, ADA", "A", "000012050"),
        [2] = new("HOPPER, GRACE", "X", "000000000"),
        [3] = new("BABBAGE, CHARLES", "Q", "000000500"),
    };

    public LegacyRecord Fetch(int id) => _records[id];
}

public record Customer(string Name, string Status, int BalanceCents); // billing's own model

public class CustomerGateway(LegacyCrm crm) // Anti-corruption layer: the only code that knows the CRM's model
{
    private static readonly Dictionary<string, string> Statuses = new() { ["A"] = "active", ["I"] = "closed", ["X"] = "closed" };

    private static string Capitalise(string word) => char.ToUpper(word[0]) + word[1..].ToLower();

    public Customer Find(int id)
    {
        var record = crm.Fetch(id);
        var parts = record.CUST_NM.Split(", ");
        if (!Statuses.TryGetValue(record.STAT_CD, out var status))
            throw new InvalidOperationException($"unknown status code {record.STAT_CD}");
        return new Customer($"{Capitalise(parts[1])} {Capitalise(parts[0])}", status, int.Parse(record.BAL_AMT));
    }
}

public class BillingService(CustomerGateway customers) // new system: uses only its own words
{
    private static string Cents(int c) => $"{c / 100}.{c % 100:00}";

    public void Describe(int id)
    {
        try
        {
            var c = customers.Find(id);
            Console.WriteLine($"{c.Name}, {c.Status}, balance {Cents(c.BalanceCents)}");
        }
        catch (InvalidOperationException error)
        {
            Console.WriteLine($"Rejected legacy record: {error.Message}");
        }
    }
}
