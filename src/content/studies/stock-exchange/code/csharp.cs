// An order book with price-time priority in C#:
// the best price trades first, and among equal prices the order that arrived first trades first.
using System;
using System.Collections.Generic;
using System.Linq;

public class Resting { public string Id = ""; public int Qty; }
public class Level { public int Price; public List<Resting> Orders = new(); }
public record Order(string Id, bool Buy, int Price, int Qty);
public record Trade(string Buyer, string Seller, int Price, int Qty);

public class OrderBook
{
    public readonly List<Level> Bids = new(); // each side: price levels, best first; a level holds its orders in arrival order
    public readonly List<Level> Asks = new();

    public List<Trade> Place(Order order)
    {
        var trades = new List<Trade>();
        int qty = order.Qty;
        var opposite = order.Buy ? Asks : Bids;
        bool Crosses(int p) => order.Buy ? p <= order.Price : p >= order.Price;
        while (qty > 0 && opposite.Count > 0 && Crosses(opposite[0].Price))
        {
            var level = opposite[0];
            var resting = level.Orders[0]; // the oldest order at the best price
            int filled = Math.Min(qty, resting.Qty);
            trades.Add(new Trade(order.Buy ? order.Id : resting.Id, order.Buy ? resting.Id : order.Id, level.Price, filled)); // trades at the resting order's price
            qty -= filled; resting.Qty -= filled;
            if (resting.Qty == 0) level.Orders.RemoveAt(0);
            if (level.Orders.Count == 0) opposite.RemoveAt(0);
        }
        if (qty > 0) Rest(order.Buy, new Resting { Id = order.Id, Qty = qty }, order.Price);
        return trades;
    }

    void Rest(bool buy, Resting order, int price)
    {
        var book = buy ? Bids : Asks;
        bool Before(int a, int b) => buy ? a > b : a < b; // is price a better than price b on this side?
        int i = 0;
        while (i < book.Count && Before(book[i].Price, price)) i++;
        if (i < book.Count && book[i].Price == price) book[i].Orders.Add(order); // joins the back of the queue at its price
        else book.Insert(i, new Level { Price = price, Orders = new List<Resting> { order } });
    }

    public string Depth(bool buy) => string.Join(" ", (buy ? Bids : Asks).Select(l => $"{l.Orders.Sum(o => o.Qty)}@{(l.Price / 100.0).ToString("0.00", System.Globalization.CultureInfo.InvariantCulture)}"));
}

public static class Program
{
    static string Price(int cents) => (cents / 100.0).ToString("0.00", System.Globalization.CultureInfo.InvariantCulture);

    // The same orders in the same order always give the same trades. Prices are whole cents.
    static (OrderBook, List<Trade>) RunAll()
    {
        var orders = new[]
        {
            new Order("A", false, 1005, 100),
            new Order("B", false, 1005, 50),
            new Order("C", false, 1010, 80),
            new Order("X", true, 1000, 60),
            new Order("D", true, 1005, 120), // takes all of A, then 20 of B: A arrived first
            new Order("E", true, 1010, 200), // takes the rest of B, then C, and the leftover waits as a bid
        };
        var book = new OrderBook(); var all = new List<Trade>();
        foreach (var o in orders) all.AddRange(book.Place(o));
        return (book, all);
    }

    public static int Main()
    {
        var (book, all) = RunAll();
        foreach (var t in all) Console.WriteLine($"trade: {t.Buyer} buys {t.Qty} from {t.Seller} at {Price(t.Price)}");
        Console.WriteLine($"book after: bids {book.Depth(true)} | asks {book.Depth(false)}");

        int bought = all.Sum(t => t.Qty);
        bool replay = RunAll().Item2.SequenceEqual(all);
        bool uncrossed = book.Bids.Count == 0 || book.Asks.Count == 0 || book.Bids[0].Price < book.Asks[0].Price;
        Console.WriteLine($"replayed from the same orders: identical trades {replay.ToString().ToLowerInvariant()}; best bid below best ask {uncrossed.ToString().ToLowerInvariant()}");
        return bought != 230 || !replay || !uncrossed || all[0].Seller != "A" || all[1].Seller != "B" ? 1 : 0;
    }
}
