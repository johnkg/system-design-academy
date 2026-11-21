// Coupling and cohesion. Part 1 reads a customer's country three ways (through shared global state, by reaching through
// strangers, through a narrow method) and counts the calls in each chain (the Law of Demeter). Part 2 is a model of one checkout
// feature built four ways, as a module graph whose edges have a coupling kind; for three change requests it counts the other
// modules that must change and the modules and responsibilities to re-test. Look for: the chain lengths, and what a one-module
// design does to "modules that change" and to the size of what is re-tested.
using System;
using System.Collections.Generic;
using System.Linq;

public class Address(string country) { public string Country = country; public string GetCountry() { Program.Calls++; return Country; } }
public class Customer(Address address) { public Address Addr = address; public Address GetAddress() { Program.Calls++; return Addr; } }
public class Cart(Customer customer) // a cart may know its own customer; callers should not have to
{
    public Customer Cust = customer;
    public Customer GetCustomer() { Program.Calls++; return Cust; }
    public string ShippingCountry() { Program.Calls++; return Cust.Addr.Country; }
}
public class State(Cart cart) { public Cart TheCart = cart; public Cart GetCart() { Program.Calls++; return TheCart; } }

public record Mod(string Name, string[] Has);
public record Edge(string A, string B, string Kind);

public static class Program
{
    public static int Calls = 0; // every call made on an object from outside it

    // An edge a -> b means a depends on b, with a kind from loosest to tightest.
    static readonly Dictionary<string, int> Weight = new() { ["data"] = 1, ["stamp"] = 2, ["control"] = 3, ["common"] = 4, ["content"] = 5 };
    // A change reaches a dependent only through an edge at least this tight: an internal rewrite (level 1) is seen only by modules
    // that reach into internals, a change of a data structure (level 2) by those that share or pass the structure around, a change
    // of an operation's signature (level 3) by every caller. A module that has to change absorbs it and does not pass it on.
    static readonly Dictionary<int, int> Threshold = new() { [1] = 5, [2] = 2, [3] = 1 };

    static (List<string> change, List<string> retest, int resp) Blast(Mod[] mods, Edge[] edges, string resp, int level)
    {
        var home = mods.First(m => m.Has.Contains(resp)).Name;
        var change = new List<string> { home };
        foreach (var e in edges) if (e.B == home && Weight[e.Kind] >= Threshold[level] && !change.Contains(e.A)) change.Add(e.A);
        var retest = new List<string>(change);
        foreach (var e in edges) if (change.Contains(e.B) && !retest.Contains(e.A)) retest.Add(e.A);
        return (change, retest, retest.Sum(n => mods.First(m => m.Name == n).Has.Length));
    }

    public static void Main()
    {
        var cart = new Cart(new Customer(new Address("DE"))); var global = new State(cart);
        var reads = new (string label, Func<string> read)[] {
            ("shared global state", () => global.GetCart().GetCustomer().GetAddress().GetCountry()),
            ("reaching through strangers", () => cart.GetCustomer().GetAddress().GetCountry()),
            ("narrow interface", () => cart.ShippingCountry()) };
        foreach (var (label, read) in reads)
        {
            Calls = 0; var country = read();
            Console.WriteLine($"{label}: {country} after {Calls} call{(Calls == 1 ? "" : "s")}");
        }

        var names = new[] { "Checkout", "Cart", "Pricing", "Inventory", "Billing", "Notifications", "Reports" };
        var mods = names.Select(n => new Mod(n, new[] { n })).ToArray();
        var flow = new[] { ("Checkout", "Cart"), ("Checkout", "Pricing"), ("Checkout", "Inventory"), ("Checkout", "Billing"), ("Checkout", "Notifications"),
            ("Pricing", "Cart"), ("Inventory", "Cart"), ("Billing", "Pricing"), ("Notifications", "Billing"), ("Notifications", "Cart"),
            ("Reports", "Cart"), ("Reports", "Pricing"), ("Reports", "Inventory"), ("Reports", "Billing") };
        var designs = new (string label, Mod[] ms, Edge[] edges)[] {
            ("shared global state", mods, flow.Select(f => new Edge(f.Item1, f.Item2, "common")).ToArray()),
            ("reaching into internals", mods, flow.Select(f => new Edge(f.Item1, f.Item2, "content")).ToArray()),
            ("narrow interfaces", mods, new[] { new Edge("Checkout", "Cart", "data"), new Edge("Checkout", "Pricing", "stamp"), new Edge("Checkout", "Inventory", "data"),
                new Edge("Checkout", "Billing", "data"), new Edge("Checkout", "Notifications", "control"), new Edge("Reports", "Checkout", "stamp") }),
            ("one big module", new[] { new Mod("Monolith", names) }, new Edge[0]) };
        var changes = new[] { ("add a currency field to the price structure", "Pricing", 2), ("rewrite how stock is reserved (internal)", "Inventory", 1),
            ("change the signature of the charge call", "Billing", 3) };
        foreach (var (label, ms, edges) in designs)
        {
            Console.WriteLine($"-- {label}: {edges.Length} dependencies, coupling score {edges.Sum(e => Weight[e.Kind])}, largest module holds {ms.Max(m => m.Has.Length)} responsibilities");
            foreach (var (text, resp, level) in changes)
            {
                var (change, retest, respN) = Blast(ms, edges, resp, level);
                var others = change.Count > 1 ? string.Join(", ", change.Skip(1)) : "none";
                Console.WriteLine($"  {text}: {change.Count - 1} other modules must change ({others}); {retest.Count} modules and {respN} responsibilities re-tested");
            }
        }
    }
}
