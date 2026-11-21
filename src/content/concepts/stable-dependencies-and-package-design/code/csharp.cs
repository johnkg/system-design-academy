// Stable dependencies and package design: the same product split into packages three ways. Each design is DATA: packages
// (with an assumed number of changes per quarter) and "A depends on B" edges. Everything printed is computed from it.
// Terms: Ca is how many packages depend on a package (afferent), Ce is how many it depends on (efferent).
// Instability I = Ce * 100 / (Ca + Ce), rounded down: 0 is maximally stable (others depend on it, it depends on
// nothing), 100 is maximally unstable. The Stable Dependencies Principle: depend in the direction of stability, so an
// edge from A to B is a violation when B is less stable than A. Acyclic Dependencies: no package can reach itself.
// Look for: the cycle among orders, billing, customers and utils, what one change to utils rebuilds, and what splitting
// every class into its own package costs when a feature crosses layers.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    class Design
    {
        public string Name = ""; public List<(string Name, int Changes)> Changes = new(); public List<(string A, string B)> Edges = new();
        public string[] Feature = Array.Empty<string>(); public Dictionary<string, string> Roles = new();
    }

    static Design Make(string name, (string, int)[] changes, string[] edges, string[] feature, string helper, string customerRules, string orderRules, string customerContract) => new()
    {
        Name = name, Changes = changes.ToList(), Feature = feature,
        Edges = edges.Select(e => { var p = e.Split('>'); return (p[0], p[1]); }).ToList(),
        Roles = new() { ["helper"] = helper, ["customerRules"] = customerRules, ["orderRules"] = orderRules, ["customerContract"] = customerContract },
    };

    static readonly Design[] Designs =
    {
        Make("Tangled: a utils package and a cycle",
            new[] { ("web", 10), ("orders", 8), ("billing", 6), ("customers", 5), ("notifications", 3), ("reports", 4), ("utils", 12) },
            new[] { "web>orders", "web>billing", "web>reports", "web>notifications", "orders>billing", "billing>customers", "customers>orders", "orders>utils",
                    "billing>utils", "customers>utils", "notifications>utils", "notifications>customers", "reports>orders", "reports>utils", "utils>customers" },
            new[] { "customers", "billing", "web" }, "utils", "customers", "orders", "customers"),
        Make("Layered: acyclic, small stable bases",
            new[] { ("web", 10), ("orders", 8), ("billing", 6), ("customers", 5), ("notifications", 3), ("reports", 4), ("money", 1), ("text", 2) },
            new[] { "web>orders", "web>billing", "web>reports", "web>notifications", "orders>billing", "orders>customers", "billing>customers", "billing>money",
                    "reports>orders", "reports>text", "notifications>customers", "notifications>text", "customers>money" },
            new[] { "customers", "billing", "web" }, "money", "customers", "orders", "customers"),
        Make("Over-split: an api and an impl package for everything",
            new[] { ("web", 10), ("orders-api", 1), ("orders-impl", 8), ("billing-api", 1), ("billing-impl", 6), ("customers-api", 1), ("customers-impl", 5),
                    ("notifications-api", 1), ("notifications-impl", 3), ("reports", 4), ("money", 1), ("text", 2), ("app", 3) },
            new[] { "web>orders-api", "web>billing-api", "web>reports", "web>notifications-api", "orders-impl>orders-api", "orders-impl>billing-api",
                    "orders-impl>customers-api", "billing-impl>billing-api", "billing-impl>customers-api", "billing-impl>money", "customers-impl>customers-api",
                    "customers-impl>money", "notifications-impl>notifications-api", "notifications-impl>customers-api", "notifications-impl>text",
                    "reports>orders-api", "reports>text", "app>web", "app>orders-impl", "app>billing-impl", "app>customers-impl", "app>notifications-impl" },
            new[] { "customers-api", "customers-impl", "billing-api", "billing-impl", "web" }, "money", "customers-impl", "orders-impl", "customers-api"),
    };
    static readonly (string Key, string Label)[] Changes =
    {
        ("helper", "the shared helper package"), ("customerRules", "customer rules"), ("orderRules", "order rules"), ("customerContract", "the customer contract"),
    };

    // Packages reachable from `start` by following edges forward (breadth-first); `start` itself only if a cycle returns to it.
    static HashSet<string> Reach(Design d, string start)
    {
        var seen = new HashSet<string>(); var queue = new Queue<string>(); queue.Enqueue(start);
        while (queue.Count > 0)
        {
            var cur = queue.Dequeue();
            foreach (var (a, b) in d.Edges) if (a == cur && seen.Add(b)) queue.Enqueue(b);
        }
        return seen;
    }

    // A change to p forces a rebuild and retest of p and of every package that depends on it, directly or not.
    static HashSet<string> RebuildSet(Design d, string p)
    {
        var o = new HashSet<string> { p };
        foreach (var (q, _) in d.Changes) if (Reach(d, q).Contains(p)) o.Add(q);
        return o;
    }

    static int Instability(Design d, string p)
    {
        int ce = d.Edges.Count(e => e.A == p), ca = d.Edges.Count(e => e.B == p);
        return ca + ce == 0 ? 0 : (ce * 100) / (ca + ce);
    }

    static int BuildsPerQuarter(Design d) => d.Changes.Sum(c => c.Changes * RebuildSet(d, c.Name).Count);

    public static void Main()
    {
        foreach (var d in Designs)
        {
            int total = d.Changes.Count;
            int cyc = d.Changes.Count(c => Reach(d, c.Name).Contains(c.Name));
            int viol = d.Edges.Count(e => Instability(d, e.B) > Instability(d, e.A));
            Console.WriteLine($"== {d.Name}");
            Console.WriteLine($"  packages: {total}; dependency edges: {d.Edges.Count}; packages in a cycle (must be released together): {cyc}; edges that depend on something less stable: {viol}");
            Console.WriteLine($"  package builds per quarter, from the assumed change counts: {BuildsPerQuarter(d)}; packages edited by a feature that adds one customer field to the web page: {d.Feature.Length}");
            foreach (var (key, label) in Changes)
            {
                var p = d.Roles[key];
                Console.WriteLine($"  a change to {label} ({p}, instability {Instability(d, p)}) rebuilds and retests {RebuildSet(d, p).Count} of {total} packages");
            }
        }
    }
}
