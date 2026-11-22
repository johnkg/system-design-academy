// Blast radius of one compromised host in 12 services, under four network policies. Toy model: integers and fixed data only.
// Assumption (worst case, stated): every host the attacker can open a connection to can be taken over in turn.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    static readonly string[] Hosts = { "web", "bff", "orders", "payments", "inventory", "search", "users", "orders-db", "users-db", "cache", "ci", "monitor" };
    static readonly Dictionary<string, string> Zone = new()
    {
        ["web"] = "edge", ["bff"] = "edge", ["orders"] = "app", ["payments"] = "app", ["inventory"] = "app", ["search"] = "app", ["users"] = "app",
        ["orders-db"] = "data", ["users-db"] = "data", ["cache"] = "data", ["ci"] = "ops", ["monitor"] = "ops",
    };
    static readonly string[] Jewels = { "orders-db", "users-db", "payments" };
    // The calls the system really needs: (caller, callee, approved). The last four were added since the last policy review (approved = false).
    static readonly (string A, string B, bool Ok)[] Flows = new (string, string, bool)[]
    {
        ("web", "orders", true), ("web", "search", true), ("web", "users", true), ("bff", "orders", true), ("bff", "users", false),
        ("orders", "payments", true), ("orders", "inventory", true), ("orders", "orders-db", true), ("orders", "cache", true),
        ("users", "users-db", true), ("users", "cache", true), ("search", "cache", false),
        ("ci", "web", true), ("ci", "orders", true), ("ci", "users", false),
    }.Concat(new[] { "web", "bff", "orders", "payments", "inventory", "users", "cache" }.Select(h => ("monitor", h, true)))
     .Concat(new[] { ("monitor", "search", false) }).ToArray();
    // Segmentation: which zone may open connections to which. Inside a zone every host can talk to every other.
    static readonly Dictionary<string, string[]> ZoneRules = new()
    {
        ["edge"] = new[] { "edge", "app" }, ["app"] = new[] { "app", "data" }, ["data"] = new[] { "data" }, ["ops"] = new[] { "ops", "edge", "app", "data" },
    };

    static HashSet<string> Allowed(string variant, bool exceptions)
    {
        var set = new HashSet<string>();
        foreach (var a in Hosts) foreach (var b in Hosts)
        {
            if (a == b) continue;
            if (variant == "flat" || (variant == "segmented" && ZoneRules[Zone[a]].Contains(Zone[b]))) set.Add(a + ">" + b);
        }
        if (variant == "identity" || variant == "strict")
        {
            foreach (var (a, b, ok) in Flows)
            {
                if (variant == "identity" || ok) set.Add(a + ">" + b);
                // The "exception" people grant to unblock a broken flow in a hurry: caller may reach the callee's whole zone.
                else if (exceptions) foreach (var c in Hosts) if (Zone[c] == Zone[b] && c != a) set.Add(a + ">" + c);
            }
        }
        return set;
    }

    static HashSet<string> Reach(HashSet<string> edges, string start)
    {
        var seen = new HashSet<string> { start };
        var queue = new Queue<string>(); queue.Enqueue(start);
        while (queue.Count > 0)
        {
            var a = queue.Dequeue();
            foreach (var b in Hosts) if (edges.Contains(a + ">" + b) && !seen.Contains(b)) { seen.Add(b); queue.Enqueue(b); }
        }
        seen.Remove(start); return seen;
    }

    static void Report(string name, string variant, bool exceptions)
    {
        var edges = Allowed(variant, exceptions);
        int working = Flows.Count(f => edges.Contains(f.A + ">" + f.B));
        Console.WriteLine($"-- {name}");
        Console.WriteLine($"  allowed connections {edges.Count} of 132; needed flows working {working} of {Flows.Length}; connections nobody needs {edges.Count - working}");
        foreach (var h in new[] { "web", "search", "ci" })
        {
            var r = Reach(edges, h);
            int direct = Hosts.Count(b => edges.Contains(h + ">" + b));
            int jewels = Jewels.Count(j => r.Contains(j));
            Console.WriteLine($"  {h} compromised: direct connections {direct}; hosts reached by pivoting {r.Count}; crown jewels reached {jewels} of {Jewels.Length}");
        }
        int total = Hosts.Sum(h => Reach(edges, h).Count);
        Console.WriteLine($"  summed over each of the 12 hosts as the entry point: {total} of 132 host takeovers possible");
    }

    public static void Main()
    {
        Report("flat network: everything reaches everything", "flat", false);
        Report("segmented: zones edge, app, data, ops", "segmented", false);
        Report("identity-based: mTLS, each service lists who may call it", "identity", false);
        Report("over-applied: only reviewed flows allowed, no exceptions", "strict", false);
        Report("over-applied, then broad exceptions granted to unblock", "strict", true);
        Console.WriteLine("-- search tries to call orders-db directly");
        foreach (var v in new[] { "flat", "segmented", "identity" }) Console.WriteLine($"  {v}: {(Allowed(v, false).Contains("search>orders-db") ? "allowed" : "denied")}");
    }
}
