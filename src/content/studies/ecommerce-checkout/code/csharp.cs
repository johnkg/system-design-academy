// Inventory reservations and an order saga, in C#:
// stock is taken with a hold that expires, an order is placed once per idempotency key,
// failures are undone in reverse order, and every status change is also written to an outbox.
using System;
using System.Collections.Generic;
using System.Linq;

public class Inventory
{
    public int Available;
    public readonly Dictionary<int, (int Qty, int Expires)> Holds = new(); // order id -> hold
    public Inventory(int stock) { Available = stock; }
    public bool Reserve(int orderId, int qty, int expires)
    {
        if (Holds.ContainsKey(orderId)) return true;  // the same request again: already reserved
        if (Available < qty) return false;            // the conditional decrement: never below zero
        Available -= qty; Holds[orderId] = (qty, expires); return true;
    }
    public void Commit(int orderId) => Holds.Remove(orderId); // the stock stays taken, and the hold is used up
    public void Release(int orderId) { if (Holds.TryGetValue(orderId, out var h)) { Available += h.Qty; Holds.Remove(orderId); } }
    public void Restock(int qty) => Available += qty;
    public List<int> Expire(int now) // give back every hold whose time ran out
    {
        var gone = Holds.Where(h => h.Value.Expires <= now).Select(h => h.Key).ToList();
        gone.ForEach(Release);
        return gone;
    }
}

public class Order { public int Id; public string Key = ""; public string Status = ""; }
public class Buyer { public string Key = ""; public int Tick; public bool Pays, Declined, ShipFails, Double; public int Delay; }
public class Row { public bool Sent; }

public static class Program
{
    const int STOCK = 30, TTL = 3, BUYERS = 80, PER_TICK = 10;
    const int Seed = 11, Ticks = 12;
    const int AfterAllHolds = 99; // a time when every hold has expired
    // Buyer behaviour, in percent: who never pays, gets declined, has shipping fail, or double-clicks.
    const int NoPayPercent = 30, DeclinePercent = 15, ShipFailPercent = 10, DoubleClickPercent = 20;
    const int PayDelays = 5; // a buyer pays 0..4 ticks after reserving
    const int RelayCrashPercent = 10;
    static ulong seed = Seed;
    // Linear congruential generator (Numerical Recipes constants), high 16 bits.
    static int Random(int n) { seed = (seed * 1664525UL + 1013904223UL) % 4294967296UL; return (int)((seed / 65536) % (ulong)n); }

    static readonly Inventory inv = new(STOCK);
    static readonly Dictionary<string, Order> orders = new();
    static readonly Dictionary<int, Order> byId = new();
    static readonly List<Row> outbox = new();
    static int duplicates, charged, refunded, lateLost;

    static void SetStatus(Order order, string status) { order.Status = status; outbox.Add(new Row()); } // the status and its event are written together
    static Order Place(string key) // idempotent: one order per key, however many times the button is pressed
    {
        if (orders.TryGetValue(key, out var existing)) { duplicates++; return existing; }
        var order = new Order { Id = orders.Count + 1, Key = key }; orders[key] = order; byId[order.Id] = order; SetStatus(order, "PENDING");
        return order;
    }

    static void Pay(Order order, Buyer b, int now) // the saga: reserve (done) -> charge -> ship, and undo in reverse order on failure
    {
        if (order.Status == "EXPIRED" && !inv.Reserve(order.Id, 1, now + TTL)) { SetStatus(order, "SOLD_OUT"); lateLost++; return; }
        if (b.Declined) { inv.Release(order.Id); SetStatus(order, "DECLINED"); return; }          // undo: release the hold
        charged++; inv.Commit(order.Id);
        if (b.ShipFails) { refunded++; inv.Restock(1); SetStatus(order, "CANCELLED"); return; }  // undo: refund, then restock
        SetStatus(order, "CONFIRMED");
    }

    public static int Main()
    {
        var buyers = new List<Buyer>();
        for (int i = 0; i < BUYERS; i++)
        {
            var b = new Buyer { Key = $"k{i}", Tick = i / PER_TICK };
            b.Pays = Random(100) >= NoPayPercent; b.Declined = Random(100) < DeclinePercent; b.Delay = Random(PayDelays);
            b.ShipFails = Random(100) < ShipFailPercent; b.Double = Random(100) < DoubleClickPercent;
            buyers.Add(b);
        }

        var waiting = new List<(Order Order, Buyer B, int Due)>();
        for (int t = 0; t < Ticks; t++)
        {
            inv.Expire(t).ForEach(id => SetStatus(byId[id], "EXPIRED"));
            foreach (var b in buyers.Where(x => x.Tick == t))
            {
                var order = Place(b.Key);
                if (b.Double) Place(b.Key);                                  // a double click
                if (!inv.Reserve(order.Id, 1, t + TTL)) SetStatus(order, "SOLD_OUT");
                else if (b.Pays) waiting.Add((order, b, t + b.Delay));
            }
            foreach (var w in waiting.Where(w => w.Due == t).ToList()) Pay(w.Order, w.B, t);
        }
        inv.Expire(AfterAllHolds).ForEach(id => SetStatus(byId[id], "EXPIRED")); // the buyers who never paid

        // Row ids are 1..outbox.Count in order, so the bus can hold just the ids.
        var bus = new List<int>();
        while (true) // the relay: publish unsent rows, and sometimes crash before marking one as sent
        {
            bool crashed = false;
            for (int i = 0; i < outbox.Count; i++)
            {
                if (outbox[i].Sent) continue;
                bus.Add(i + 1);
                if (Random(100) < RelayCrashPercent) { crashed = true; break; }
                outbox[i].Sent = true;
            }
            if (!crashed) break;
        }

        int Count(string s) => orders.Values.Count(o => o.Status == s);
        int confirmed = Count("CONFIRMED");
        Console.WriteLine($"orders {orders.Count}: confirmed {confirmed}, sold out {Count("SOLD_OUT")}, declined {Count("DECLINED")}, expired {Count("EXPIRED")}, cancelled {Count("CANCELLED")}");
        Console.WriteLine($"late payers who lost their stock {lateLost}, double clicks absorbed {duplicates}");
        Console.WriteLine($"stock {STOCK} = available {inv.Available} + sold {confirmed}; charged {charged}, refunded {refunded}");
        Console.WriteLine($"outbox rows {outbox.Count}, bus deliveries {bus.Count}, redelivered {bus.Count - outbox.Count}, applied once {bus.Distinct().Count()}");

        bool ok = confirmed <= STOCK && inv.Available + confirmed == STOCK && inv.Holds.Count == 0
            && charged - refunded == confirmed && bus.Distinct().Count() == outbox.Count;
        return ok ? 0 : 1;
    }
}
