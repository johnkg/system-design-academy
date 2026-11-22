// Monolith, modular monolith and microservices: one shop (6 modules) cut into deployable units five ways, hit by the same four changes.
// Look for: deploys per change, teams that must ship a release (in one deployable that is every team; with separate services each ships on its own schedule unless they share a database), network calls per checkout, and how many modules fail when Payments misbehaves.
// A design says how modules map to deployables (together = one process), whether the database is shared, whether module internals leak to callers,
// whether callers have fallbacks, and how many separate services one module is split into (1 or 3: api, logic, store).
// Assumption for latency: every network call costs the same fixed number of milliseconds (here 2).
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    record Design(string Name, bool Together, bool SharedDb, bool Leaky, int Split, bool Fallbacks);
    record Change(string Text, string Kind, string Module, string[] Consumers);

    static readonly string[] Modules = { "catalog", "cart", "orders", "payments", "shipping", "notify" };
    static readonly (string Caller, string Callee)[] Checkout =
    {
        ("orders", "cart"), ("cart", "catalog"), ("orders", "payments"), ("orders", "shipping"), ("shipping", "notify"),
    };
    static readonly string[] Layers = { "api", "logic", "store" };

    static readonly Design[] Designs =
    {
        new("Big ball monolith", true, true, true, 1, false),
        new("Modular monolith", true, false, false, 1, false),
        new("Microservices", false, false, false, 1, true),
        new("Distributed monolith", false, true, true, 1, false),
        new("Nanoservices", false, false, false, 3, false),
    };

    // kind: logic (private rule), contract (a field others read), schema (a table column), all (a platform upgrade)
    static readonly Change[] Changes =
    {
        new("change a price rule in Catalog", "logic", "catalog", new string[] { }),
        new("add a field to the Orders contract", "contract", "orders", new[] { "payments", "shipping", "notify" }),
        new("rename a column in the Orders table", "schema", "orders", new string[] { }),
        new("upgrade the web framework everywhere", "all", "", new string[] { }),
    };

    static IEnumerable<string> CallersOf(string m) => Checkout.Where(e => e.Callee == m).Select(e => e.Caller);

    // Edits as (module, layers touched). Layers only matter when a module is split into 3 services.
    static List<(string M, string[] L)> Edits(Design d, Change c)
    {
        if (c.Kind == "all") return Modules.Select(m => (m, Layers)).ToList();
        if (c.Kind == "logic")
        {
            var r = new List<(string, string[])> { (c.Module, new[] { "logic" }) };
            if (d.Leaky) r.AddRange(CallersOf(c.Module).Select(m => (m, new[] { "logic" })));
            return r;
        }
        if (c.Kind == "contract")
        {
            var r = new List<(string, string[])> { (c.Module, Layers) };
            r.AddRange(c.Consumers.Select(m => (m, new[] { "logic" })));
            return r;
        }
        if (d.SharedDb) return Modules.Select(m => (m, m == c.Module ? new[] { "logic", "store" } : new[] { "logic" })).ToList();
        return new List<(string, string[])> { (c.Module, new[] { "logic", "store" }) };
    }

    static string Deployable(Design d, string m, string layer) => d.Together ? "app" : d.Split == 1 ? m : m + "." + layer;

    static (int, int, int) Analyse(Design d, Change c)
    {
        var es = Edits(d, c);
        var units = new HashSet<string>();
        foreach (var (m, layers) in es) foreach (var l in layers) units.Add(Deployable(d, m, l));
        int teams = d.Together ? Modules.Length : es.Count; // one team per module; a shared deployable makes every team wait
        return (es.Count, units.Count, teams);
    }

    static int CheckoutCalls(Design d)
    {
        if (d.Together) return 0;
        var visited = new HashSet<string>();
        foreach (var (a, b) in Checkout) { visited.Add(a); visited.Add(b); }
        return Checkout.Length + (d.Split == 3 ? 2 * visited.Count : 0); // api -> logic -> store inside each module is 2 more calls
    }

    static int Failing(Design d) // modules whose requests fail when Payments crashes or holds a lock
    {
        if (d.Together || d.SharedDb) return Modules.Length;
        var o = new HashSet<string> { "payments" };
        if (!d.Fallbacks)
        {
            bool grew = true;
            while (grew)
            {
                grew = false;
                foreach (var (a, b) in Checkout) if (o.Contains(b) && !o.Contains(a)) { o.Add(a); grew = true; }
            }
        }
        return o.Count;
    }

    public static void Main()
    {
        const int Ms = 2;
        foreach (var d in Designs)
        {
            int calls = CheckoutCalls(d);
            Console.WriteLine($"== {d.Name}: {calls} network calls per checkout ({calls * Ms} ms at {Ms} ms each), {Failing(d)} of {Modules.Length} modules fail when Payments misbehaves");
            int tm = 0, td = 0, tt = 0, i = 0;
            foreach (var c in Changes)
            {
                var (m, dp, t) = Analyse(d, c);
                i++;
                Console.WriteLine($"  C{i} {c.Text}: edit {m} modules, {dp} deploys, {t} teams must ship");
                tm += m; td += dp; tt += t;
            }
            Console.WriteLine($"  four changes: {tm} modules edited, {td} deploys, {tt} team-releases");
        }
    }
}
