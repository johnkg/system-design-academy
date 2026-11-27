// Backends for Frontends in C#. Each client gets a small backend that shapes the shared services' data.
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        var orders = new OrderService();
        var mobile = new MobileBff(orders);
        var web = new WebBff(orders, new CustomerService());

        Console.WriteLine($"mobile: {mobile.GetOrder(7)}, service calls: {mobile.Calls}");
        Console.WriteLine($"web: {web.GetOrder(7)}, service calls: {web.Calls}");
    }

    public static string Money(int cents) => $"{cents / 100}.{cents % 100:00}";
}

public record Order(int Id, int CustomerId, List<(string Item, int Cents)> Lines, int TotalCents);

public class OrderService // Shared service: business data, nothing client-specific
{
    public Order Get(int id) => new(id, 1, new() { ("apple", 1500), ("pear", 2500) }, 4000);
}

public class CustomerService // Shared service
{
    public string NameOf(int customerId) => "Ada";
}

public class MobileBff(OrderService orders) // Backend for the phone app: two fields, one service call
{
    public int Calls { get; private set; }

    public string GetOrder(int id)
    {
        Calls++;
        var order = orders.Get(id);
        return $"order {order.Id}, total {Program.Money(order.TotalCents)}";
    }
}

public class WebBff(OrderService orders, CustomerService customers) // Backend for the website: combines two services into one answer
{
    public int Calls { get; private set; }

    public string GetOrder(int id)
    {
        Calls += 2;
        var order = orders.Get(id);
        var name = customers.NameOf(order.CustomerId);
        return $"order {order.Id} for {name}, {order.Lines.Count} lines, total {Program.Money(order.TotalCents)}";
    }
}
