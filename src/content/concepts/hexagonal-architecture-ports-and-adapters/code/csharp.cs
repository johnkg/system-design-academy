// Hexagonal architecture: one order service built four ways, hit by the same four changes.
// Look for: files edited per change, unrelated behaviour ("bystanders") inside edited files, tests to run again, and how much infrastructure the rule tests need.
// A file is (name, what it holds, shape fields it copies, files it imports). A change touches tokens; a file is edited if it holds or copies one.
// Tokens: rule (business rule), db (how the database is used), vendor (payment vendor details), mail, entry (HTTP details),
// port (the interfaces the core defines), shape (the fields of an order, copied by every file that maps it), wiring (what is plugged into what).
// The "Direct calls" design has no wiring file: its use cases construct the clients themselves.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    record F(string Name, string[] Holds, string[] Copies, string[] Imports);

    static readonly string[] None = { };
    static readonly string[] MainImports = { "HttpAdapter", "SqlAdapter", "VendorAdapter", "MailAdapter", "PlaceOrder", "CancelOrder", "OrderReport" };
    static readonly string[] UseCases = { "PlaceOrder", "CancelOrder", "OrderReport" };
    static string[] S(params string[] x) => x;

    static readonly (string Name, F[] Files)[] Designs =
    {
        ("Direct calls", new F[]
        {
            new("HttpHandler", S("entry"), S("shape"), UseCases),
            new("PlaceOrder", S("rule", "db", "vendor", "mail"), S("shape"), S("SqlStore", "VendorClient", "MailClient")),
            new("CancelOrder", S("rule", "db", "vendor", "mail"), None, S("SqlStore", "VendorClient", "MailClient")),
            new("OrderReport", S("db"), None, S("SqlStore")),
            new("SqlStore", S("db"), S("shape"), None),
            new("VendorClient", S("vendor"), None, None),
            new("MailClient", S("mail"), None, None),
        }),
        ("Ports and adapters", new F[]
        {
            new("HttpAdapter", S("entry"), S("shape"), UseCases),
            new("PlaceOrder", S("rule"), None, S("Ports", "Order")),
            new("CancelOrder", S("rule"), None, S("Ports", "Order")),
            new("OrderReport", None, None, S("Ports")),
            new("Order", None, S("shape"), None),
            new("Ports", S("port"), None, S("Order")),
            new("SqlAdapter", S("db"), S("shape"), S("Ports", "Order")),
            new("VendorAdapter", S("vendor"), None, S("Ports")),
            new("MailAdapter", S("mail"), None, S("Ports")),
            new("Main", S("wiring"), None, MainImports),
        }),
        ("Ports shaped like the vendor", new F[]
        {
            new("HttpAdapter", S("entry"), S("shape"), UseCases),
            new("PlaceOrder", S("rule", "vendor"), None, S("Ports", "Order")), // the use case reads the vendor's status codes
            new("CancelOrder", S("rule", "vendor"), None, S("Ports", "Order")),
            new("OrderReport", None, None, S("Ports")),
            new("Order", None, S("shape"), None),
            new("Ports", S("port", "vendor"), None, S("Order")), // the port copies the vendor's method names and flags
            new("SqlAdapter", S("db"), S("shape"), S("Ports", "Order")),
            new("VendorAdapter", S("vendor"), None, S("Ports")),
            new("MailAdapter", S("mail"), None, S("Ports")),
            new("Main", S("wiring"), None, MainImports),
        }),
        ("Everything behind a port", new F[]
        {
            new("HttpAdapter", S("entry"), S("shape"), S("RequestMapper")),
            new("RequestMapper", None, S("shape"), UseCases),
            new("PlaceOrder", S("rule"), S("shape"), S("Ports", "Order")),
            new("CancelOrder", S("rule"), None, S("Ports", "Order")),
            new("OrderReport", None, None, S("Ports")),
            new("Order", None, S("shape"), None),
            new("Ports", S("port"), None, S("Order")),
            new("ClockPort", None, None, None),
            new("IdPort", None, None, None),
            new("LoggerPort", None, None, None),
            new("PersistenceMapper", None, S("shape"), S("Order", "PersistenceModel")),
            new("PersistenceModel", None, S("shape"), None),
            new("SqlAdapter", S("db"), S("shape"), S("Ports", "PersistenceMapper", "PersistenceModel")),
            new("VendorAdapter", S("vendor"), None, S("Ports")),
            new("MailAdapter", S("mail"), None, S("Ports")),
            new("Main", S("wiring"), None, MainImports),
        }),
    };

    static readonly (string Text, string[] Touches)[] Changes =
    {
        ("swap the database engine", S("db", "wiring")),
        ("switch payment vendor", S("vendor", "wiring")),
        ("change the free-shipping rule", S("rule")),
        ("add a field to an order", S("shape")),
    };

    static (List<string>, int, int) Analyse(F[] files, string[] touches)
    {
        bool Hit(string[] ts) => ts.Any(t => touches.Contains(t));
        var edited = files.Where(f => Hit(f.Holds) || Hit(f.Copies)).ToList();
        int bystanders = 0;
        foreach (var f in edited) foreach (var t in f.Holds) if (!touches.Contains(t)) bystanders++;
        var retest = new HashSet<string>(edited.Select(f => f.Name));
        bool grew = true;
        while (grew) // anything that imports a retested file must be retested too
        {
            grew = false;
            foreach (var f in files)
                if (!retest.Contains(f.Name) && f.Imports.Any(c => retest.Contains(c))) { retest.Add(f.Name); grew = true; }
        }
        return (edited.Select(f => f.Name).ToList(), bystanders, retest.Count);
    }

    static int InfraNeededForRuleTests(F[] files) // files holding db, vendor or mail that PlaceOrder reaches through imports
    {
        var byName = files.ToDictionary(f => f.Name);
        var seen = new HashSet<string> { "PlaceOrder" };
        var todo = new Stack<string>();
        todo.Push("PlaceOrder");
        while (todo.Count > 0)
            foreach (var i in byName[todo.Pop()].Imports) if (seen.Add(i)) todo.Push(i);
        bool IsInfra(F f) => f.Holds.Any(t => t == "db" || t == "vendor" || t == "mail") && !f.Holds.Contains("port") && !f.Holds.Contains("rule");
        return seen.Count(n => IsInfra(byName[n]));
    }

    public static void Main()
    {
        foreach (var (name, files) in Designs)
        {
            Console.WriteLine($"== {name}: {files.Length} files, {InfraNeededForRuleTests(files)} infrastructure files needed to test the rule");
            int te = 0, tb = 0, tr = 0, i = 0;
            foreach (var (text, touches) in Changes)
            {
                var (edited, by, rt) = Analyse(files, touches);
                i++;
                Console.WriteLine($"  C{i} {text}: edit {edited.Count} ({string.Join(", ", edited)}); bystander behaviours {by}; retest {rt}");
                te += edited.Count; tb += by; tr += rt;
            }
            Console.WriteLine($"  four changes: {te} files edited, {tb} bystander behaviours, {tr} retests");
        }
    }
}
