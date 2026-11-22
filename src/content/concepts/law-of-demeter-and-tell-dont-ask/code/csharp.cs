// Law of Demeter and Tell, Don't Ask. Part 1 runs real objects (Order, Customer, Address, Country) through a change: customers get a
// separate shipping address, and the old `address` becomes the billing one. Call sites that reach through the chain keep compiling
// and silently charge the wrong tax; the one that tells the order what to do is fixed in one place. Part 2 counts what each design
// makes you edit for four change requests, from a small model of a codebase: 12 call sites, 4 classes, 8 pieces of data.
// Look for: 190 vs 200, and how the edits spread (7 modules vs 1 class), and the price of forwarding everything.
using System;
using System.Collections.Generic;
using System.Linq;

class Country
{
    public string Name; public int Rate;
    public Country(string name, int rate) { Name = name; Rate = rate; }
    public int TaxOn(int amount) => amount * Rate / 100;
}
class Address
{
    public string Street; public Country Country;
    public Address(string street, Country country) { Street = street; Country = country; }
    public int TaxOn(int amount) => Country.TaxOn(amount);
}
class Customer
{
    public string Name; public Address Address; public Address Shipping;
    public Customer(string name, Address address, Address shipping = null)
    {
        Name = name;
        Address = address; // v1: the only address; v2: kept for old code, now means "billing"
        Shipping = shipping ?? address;
    }
    public int TaxOn(int amount) => Shipping.TaxOn(amount); // the one place that knows which address tax follows
}
class Order
{
    public Customer Customer; public int Total;
    public Order(Customer customer, int total) { Customer = customer; Total = total; }
    public int Tax() => Customer.TaxOn(Total); // tell, don't ask: the order answers, callers do not navigate
}

public static class Program
{
    // Call sites written the train-wreck way: each one reaches through four objects.
    static int CheckoutTax(Order o) => o.Total * o.Customer.Address.Country.Rate / 100;
    static int QuoteTax(Order o) => o.Total * o.Customer.Address.Country.Rate / 100;

    // Part 2. A model of the codebase. Classes form a chain; each piece of data lives in one class (its owner).
    static readonly string[] Classes = { "Order", "Customer", "Address", "Country" };
    static readonly int[] Owner = { 1, 1, 2, 2, 3, 3, 3, 3 }; // name, tier, street, city, country name, tax rate, zone, code
    static readonly (string, int)[] Sites = { ("email", 0), ("invoice", 0), ("loyalty", 1), ("shipping", 2), ("shipping", 3), ("invoice", 4),
        ("report", 4), ("checkout", 5), ("quote", 5), ("shipping", 6), ("fraud", 7), ("export", 2) }; // (module, data it reads)
    static readonly (string, int[], int)[] Tell = { ("greeting", new[] { 0 }, 1), ("standing", new[] { 1 }, 1), ("label", new[] { 2, 3, 4 }, 2),
        ("tax", new[] { 5 }, 3), ("zone", new[] { 6 }, 3), ("risk", new[] { 7 }, 3) }; // (method, data it reads, class where it lives)

    // A unit is one piece of code that can need editing: (where, links of the chain it crosses, data whose rule it holds).
    static List<(string, HashSet<int>, HashSet<int>)> Units(string design)
    {
        var u = new List<(string, HashSet<int>, HashSet<int>)>();
        if (design == "train") // every call site walks the chain itself
        {
            foreach (var (m, op) in Sites) u.Add((m, new HashSet<int>(Enumerable.Range(1, Owner[op])), new HashSet<int> { op }));
        }
        else if (design == "forward") // every class forwards every leaf below it; call sites still decide what to do with the data
        {
            foreach (var (m, op) in Sites) u.Add((m, new HashSet<int>(), new HashSet<int> { op }));
            for (int op = 0; op < 8; op++)
                for (int c = 0; c <= Owner[op]; c++)
                    u.Add((Classes[c], c < Owner[op] ? new HashSet<int> { c + 1 } : new HashSet<int>(), new HashSet<int>()));
        }
        else // tell: one method per behaviour, living where its data is, with one-line hops above it
        {
            foreach (var (m, _) in Sites) u.Add((m, new HashSet<int>(), new HashSet<int>()));
            foreach (var (_, reads, home) in Tell)
            {
                int top = reads.Max(o => Owner[o]);
                for (int c = 0; c <= home; c++)
                    u.Add((Classes[c], c < home ? new HashSet<int> { c + 1 } : new HashSet<int>(Enumerable.Range(home + 1, Math.Max(0, top - home))),
                        c == home ? new HashSet<int>(reads) : new HashSet<int>()));
            }
        }
        return u;
    }

    static readonly (string, string, int)[] Changes = { ("Customer gets several addresses", "shape", 2), ("Address keeps its country as a code", "shape", 3),
        ("Tax rule changes", "rule", 5), ("Country gets a currency", "new", 3) };

    static List<string> Edited(string design, string kind, int arg)
    {
        if (kind == "new") // a new site, plus a hop in every class on the way down
        {
            var l = new List<string> { "checkout" };
            if (design != "train") l.AddRange(Classes.Take(arg + 1));
            return l;
        }
        if (kind == "shape") return Units(design).Where(x => x.Item2.Contains(arg)).Select(x => x.Item1).ToList();
        return Units(design).Where(x => x.Item3.Contains(arg)).Select(x => x.Item1).ToList();
    }

    public static void Main()
    {
        var de = new Country("DE", 19); var fr = new Country("FR", 20);
        var v1 = new Order(new Customer("ann", new Address("1 Main St", de)), 1000);
        Console.WriteLine($"v1, one address (DE): checkout {CheckoutTax(v1)}, quote {QuoteTax(v1)}, order.tax() {v1.Tax()}");
        var v2 = new Order(new Customer("ann", new Address("1 Main St", de), new Address("2 Rue Neuve", fr)), 1000);
        Console.WriteLine($"v2, billing DE, shipping FR: checkout {CheckoutTax(v2)}, quote {QuoteTax(v2)}, order.tax() {v2.Tax()}");

        var forwarders = new Dictionary<string, int> { ["train"] = 0, ["tell"] = Tell.Sum(t => t.Item3), ["forward"] = Owner.Sum() };
        var orderMethods = new Dictionary<string, int> { ["train"] = 0, ["tell"] = Tell.Length, ["forward"] = Owner.Length };
        foreach (var design in new[] { "train", "tell", "forward" })
        {
            var row = new List<string>();
            int edits = 0, places = 0;
            foreach (var (_, kind, arg) in Changes)
            {
                var e = Edited(design, kind, arg);
                edits += e.Count;
                places += e.Distinct().Count();
                row.Add($"edits {e.Count} places {e.Distinct().Count()}");
            }
            Console.WriteLine($"{design}: {string.Join(" | ", row)} | total {edits} edits, {places} places | order methods {orderMethods[design]}, " +
                $"forwarding-only methods {forwarders[design]}");
        }
    }
}
