// Without the pattern: the service writes SQL and reads rows itself.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    public static void Main() => new OrderService().ListOpen("ada"); // needs a database to test
}

public record Row(int Id, string Customer, int Total, string Status);

public static class Db // stand-in for a database connection
{
    public static readonly List<Row> Rows = new()
    {
        new(1, "ada", 40, "open"), new(2, "grace", 25, "open"), new(3, "ada", 15, "open"),
    };

    public static List<Row> Query(string sql, string customer)
    {
        Console.WriteLine($"SQL: {sql}");
        return Rows.Where(r => r.Customer == customer && r.Status == "open").ToList();
    }
}

public class OrderService
{
    public void ListOpen(string customer)
    {
        // The same query is copied into every service that needs orders.
        var rows = Db.Query("SELECT * FROM orders WHERE customer = ? AND status = 'open'", customer);
        Console.WriteLine($"Open orders for {customer}: {rows.Count}");
        foreach (var r in rows) Console.WriteLine($"  #{r.Id} total {r.Total}");
    }
}
