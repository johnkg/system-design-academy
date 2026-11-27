// Repository in C#. The service sees a collection of orders, not a database.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        var orders = new InMemoryOrderRepository();
        orders.Add(new Order(1, "ada", 40));
        orders.Add(new Order(2, "grace", 25));
        orders.Add(new Order(3, "ada", 15));

        var service = new OrderService(orders);
        service.ListOpen("ada");
        service.Cancel(1);
        service.ListOpen("ada");
    }
}

public class Order(int id, string customer, int total) // Entity
{
    public int Id { get; } = id;
    public string Customer { get; } = customer;
    public int Total { get; } = total;
    public string Status { get; private set; } = "open";
    public void Cancel() => Status = "cancelled";
}

public interface IOrderRepository // Repository
{
    void Add(Order order);
    Order Get(int id);
    IReadOnlyList<Order> FindOpenFor(string customer);
}

public class InMemoryOrderRepository : IOrderRepository // Concrete repository: the only place that knows how orders are stored
{
    private readonly Dictionary<int, Order> _orders = new();

    public void Add(Order order) => _orders[order.Id] = order;
    public Order Get(int id) => _orders[id];
    public IReadOnlyList<Order> FindOpenFor(string customer) =>
        _orders.Values.Where(o => o.Customer == customer && o.Status == "open").ToList();
}

public class OrderService(IOrderRepository orders) // Client: depends on the repository's methods only
{
    public void ListOpen(string customer)
    {
        var open = orders.FindOpenFor(customer);
        Console.WriteLine($"Open orders for {customer}: {open.Count}");
        foreach (var o in open) Console.WriteLine($"  #{o.Id} total {o.Total}");
    }

    public void Cancel(int id)
    {
        var order = orders.Get(id);
        order.Cancel();
        Console.WriteLine($"Order #{id} is now {order.Status}");
    }
}
