// Domain-driven design: part 1 cuts a shop's "Customer" four ways and applies four changes; part 2 draws aggregate boundaries around five entities.
// Look for: files edited and teams involved per change, tests to run again, and which business rules one transaction can still enforce.
// A file is (name, team, what it holds, data fields it copies, files it imports). A change touches tokens; a file is edited if it holds or copies one.
// Tokens: loyalty, address, payer, requester are the four teams' ideas of "customer"; ".data" is the model's fields, ".rule" is the code using them.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    record F(string Name, string Team, string[] Holds, string[] Copies, string[] Imports);

    static string[] S(params string[] x) => x;
    static readonly string[] None = { };

    static F[] Ctx(string name, string[] holds, string[] copies) => new[]
    {
        new F(name + "Model", name, holds, copies, None),
        new F(name + "Acl", name, None, holds.Concat(copies).ToArray(), S(name + "Model", "PublishedLanguage")), // the translation layer maps shared ids into the context's own model
    };

    static F[] Join(params IEnumerable<F>[] parts) => parts.SelectMany(p => p).ToArray();

    static readonly (string Name, F[] Files)[] Designs =
    {
        ("One shared model", new F[]
        {
            new("CustomerModel", "shared", S("loyalty.data", "address.data", "payer.data", "requester.data"), None, None),
            new("SalesApp", "sales", S("loyalty.rule"), None, S("CustomerModel")),
            new("ShippingApp", "shipping", S("address.rule"), None, S("CustomerModel")),
            new("BillingApp", "billing", S("payer.rule"), None, S("CustomerModel")),
            new("SupportApp", "support", S("requester.rule"), None, S("CustomerModel")),
        }),
        ("Contexts with translation", Join(
            new[] { new F("PublishedLanguage", "shared", None, None, None) },
            Ctx("Sales", S("loyalty.data"), None),
            Ctx("Shipping", S("address.data"), None),
            Ctx("Billing", S("payer.data"), None),
            Ctx("Support", S("requester.data"), None),
            new[]
            {
                new F("SalesApp", "sales", S("loyalty.rule"), None, S("SalesModel")),
                new F("ShippingApp", "shipping", S("address.rule"), None, S("ShippingModel")),
                new F("BillingApp", "billing", S("payer.rule"), None, S("BillingModel")),
                new F("SupportApp", "support", S("requester.rule"), None, S("SupportModel")),
            })),
        ("Contexts reusing upstream types", new F[]
        {
            new("SalesModel", "sales", S("loyalty.data"), None, None),
            new("ShippingModel", "shipping", S("address.data"), None, None),
            new("BillingModel", "billing", S("payer.data"), None, None),
            new("SupportModel", "support", S("requester.data"), None, None),
            new("SalesApp", "sales", S("loyalty.rule"), None, S("SalesModel")),
            new("ShippingApp", "shipping", S("address.rule"), S("loyalty.data"), S("ShippingModel", "SalesModel")), // reads the Sales customer directly
            new("BillingApp", "billing", S("payer.rule"), S("loyalty.data"), S("BillingModel", "SalesModel")),
            new("SupportApp", "support", S("requester.rule"), S("loyalty.data", "address.data"), S("SupportModel", "SalesModel", "ShippingModel")),
        }),
        ("A context per entity", Join(
            new[] { new F("PublishedLanguage", "shared", None, None, None) },
            Ctx("Loyalty", S("loyalty.data"), None),
            Ctx("Customer", None, S("loyalty.data", "address.data", "payer.data", "requester.data")),
            Ctx("Address", S("address.data"), None),
            Ctx("Payment", S("payer.data"), None),
            Ctx("Ticket", S("requester.data"), None),
            Ctx("Order", None, S("loyalty.data", "address.data", "payer.data")),
            new[]
            {
                new F("SalesApp", "sales", S("loyalty.rule"), None, S("LoyaltyModel", "CustomerModel", "OrderModel")),
                new F("ShippingApp", "shipping", S("address.rule"), None, S("AddressModel", "CustomerModel", "OrderModel")),
                new F("BillingApp", "billing", S("payer.rule"), None, S("PaymentModel", "CustomerModel", "OrderModel")),
                new F("SupportApp", "support", S("requester.rule"), None, S("TicketModel", "CustomerModel")),
            })),
    };

    static readonly (string Text, string[] Touches)[] Changes =
    {
        ("Sales adds a loyalty tier", S("loyalty.data", "loyalty.rule")),
        ("Shipping allows several addresses", S("address.data", "address.rule")),
        ("Billing separates payer from user", S("payer.data", "payer.rule")),
        ("Support calls the customer a requester", S("requester.data", "requester.rule")),
    };

    static (List<string>, int, int, int) Analyse(F[] files, string[] touches)
    {
        bool Hit(string[] ts) => ts.Any(t => touches.Contains(t));
        var edited = files.Where(f => Hit(f.Holds) || Hit(f.Copies)).ToList();
        var retest = new HashSet<string>(edited.Select(f => f.Name));
        bool grew = true;
        while (grew) // anything that imports a retested file must be retested too
        {
            grew = false;
            foreach (var f in files)
                if (!retest.Contains(f.Name) && f.Imports.Any(c => retest.Contains(c))) { retest.Add(f.Name); grew = true; }
        }
        int TeamsOf(ICollection<string> names) => files.Where(f => names.Contains(f.Name)).Select(f => f.Team).Distinct().Count();
        return (edited.Select(f => f.Name).ToList(), TeamsOf(edited.Select(f => f.Name).ToList()), retest.Count, TeamsOf(retest));
    }

    static readonly (string Text, string[] Entities)[] Invariants =
    {
        ("order total equals the sum of its lines", S("Order", "Line")),
        ("a line quantity stays above zero", S("Line")),
        ("stock never goes below zero", S("Line", "Stock")),
        ("an order ships only when paid", S("Order", "Payment")),
        ("open orders stay under the credit limit", S("Customer", "Order")),
    };

    static readonly (string Name, string[][] Groups)[] Aggregates =
    {
        ("One big aggregate", new[] { S("Customer", "Order", "Line", "Payment", "Stock") }),
        ("Order with its lines", new[] { S("Order", "Line"), S("Customer"), S("Payment"), S("Stock") }),
        ("Every entity alone", new[] { S("Customer"), S("Order"), S("Line"), S("Payment"), S("Stock") }),
    };

    public static void Main()
    {
        Console.WriteLine("Part 1: one word, four meanings");
        foreach (var (name, files) in Designs)
        {
            Console.WriteLine($"== {name}: {files.Length} files");
            int te = 0, tt = 0, tr = 0, tq = 0, i = 0;
            foreach (var (text, touches) in Changes)
            {
                var (edited, teams, retest, retestTeams) = Analyse(files, touches);
                i++;
                Console.WriteLine($"  C{i} {text}: edit {edited.Count} ({string.Join(", ", edited)}); {teams} teams edit; retest {retest} files of {retestTeams} teams");
                te += edited.Count; tt += teams; tr += retest; tq += retestTeams;
            }
            Console.WriteLine($"  four changes: {te} files edited, {tt} team-edits, {tr} retests, {tq} team-retests");
        }

        // Part 2: aggregates. An invariant can be enforced in one transaction only if all its entities sit in one aggregate.
        Console.WriteLine("Part 2: aggregates");
        foreach (var (name, groups) in Aggregates)
        {
            int atomic = Invariants.Count(inv => groups.Any(g => inv.Entities.All(e => g.Contains(e))));
            int biggest = groups.Max(g => g.Length);
            Console.WriteLine($"== {name}: aggregates {groups.Length}; rules enforced in one transaction {atomic} of {Invariants.Length}; eventual {Invariants.Length - atomic}; entities locked by the biggest write {biggest}");
        }
    }
}
