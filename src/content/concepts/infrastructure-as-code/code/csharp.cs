// Infrastructure as code in C#: diff desired state against real state into a plan, apply it, and prove a second apply changes nothing.
// A resource key is "type.name"; its value is a flat map of attributes. Changing an immutable attribute forces replacement.
using System;
using System.Collections.Generic;
using System.Linq;

using Attrs = System.Collections.Generic.Dictionary<string, string>;
using State = System.Collections.Generic.Dictionary<string, System.Collections.Generic.Dictionary<string, string>>;

public record Step(string Action, string Key, List<(string Name, string From, string To)> Changes);

public static class Program
{
    static readonly Dictionary<string, string[]> Immutable = new()
    {
        ["vpc"] = new[] { "cidr" }, ["subnet"] = new[] { "cidr" },
        ["server"] = new[] { "image", "subnet" }, ["db"] = new[] { "engine" },
    };
    static readonly Dictionary<string, string> Sign = new() { ["create"] = "+", ["update"] = "~", ["replace"] = "-/+", ["destroy"] = "-" };

    static State Clone(State s) => s.ToDictionary(kv => kv.Key, kv => new Attrs(kv.Value));
    static string Canon(State s) => string.Join(";", s.OrderBy(kv => kv.Key, StringComparer.Ordinal)
        .Select(kv => kv.Key + "{" + string.Join(",", kv.Value.OrderBy(a => a.Key, StringComparer.Ordinal).Select(a => a.Key + "=" + a.Value)) + "}"));

    static List<(string, string, string)> DiffAttrs(Attrs from, Attrs to) =>
        from.Keys.Union(to.Keys).OrderBy(n => n, StringComparer.Ordinal)
            .Where(n => from.GetValueOrDefault(n) != to.GetValueOrDefault(n))
            .Select(n => (n, from.GetValueOrDefault(n, "(none)"), to.GetValueOrDefault(n, "(none)"))).ToList();

    static List<Step> Plan(State desired, State actual)
    {
        var steps = new List<Step>();
        foreach (var key in desired.Keys.Union(actual.Keys).OrderBy(k => k, StringComparer.Ordinal))
        {
            if (!actual.ContainsKey(key)) { steps.Add(new Step("create", key, new())); continue; }
            if (!desired.ContainsKey(key)) { steps.Add(new Step("destroy", key, new())); continue; }
            var changes = DiffAttrs(actual[key], desired[key]);
            if (changes.Count == 0) continue; // already matches: nothing to do
            var forced = changes.Any(c => Immutable[key.Split('.')[0]].Contains(c.Item1));
            steps.Add(new Step(forced ? "replace" : "update", key, changes));
        }
        return steps;
    }

    static int Apply(State actual, List<Step> steps, State desired)
    {
        var calls = 0;
        foreach (var s in steps)
        {
            if (s.Action == "destroy") { actual.Remove(s.Key); calls += 1; }
            else { actual[s.Key] = new Attrs(desired[s.Key]); calls += s.Action == "replace" ? 2 : 1; } // replace = destroy + create
        }
        return calls;
    }

    static void Show(List<Step> steps)
    {
        if (steps.Count == 0) Console.WriteLine("  No changes. Real state matches the code.");
        foreach (var s in steps)
        {
            var why = string.Join(", ", s.Changes.Select(c => $"{c.Name}: {c.From} -> {c.To}"));
            Console.WriteLine($"  {Sign[s.Action]} {s.Action} {s.Key}" + (why != "" ? $" ({why})" : "") + (s.Action == "replace" ? " forces replacement" : ""));
        }
        int N(string a) => steps.Count(s => s.Action == a);
        Console.WriteLine($"  Plan: {N("create")} create, {N("update")} update, {N("replace")} replace, {N("destroy")} destroy");
    }

    static void Run(string title, State desired, State actual)
    {
        Console.WriteLine(title);
        var steps = Plan(desired, actual);
        Show(steps);
        var calls = Apply(actual, steps, desired);
        Console.WriteLine($"  applied with {calls} API calls");
        var again = Plan(desired, actual);
        if (again.Count != 0 || Apply(actual, again, desired) != 0) throw new Exception("apply is not idempotent");
        if (Canon(actual) != Canon(desired)) throw new Exception("real state differs from desired");
        Console.WriteLine("  second apply: 0 changes");
    }

    static Attrs Web(string size, string image = "ami-1") => new() { ["size"] = size, ["image"] = image, ["subnet"] = "subnet.app" };
    static Attrs Db(string engine, string storage) => new() { ["engine"] = engine, ["storage"] = storage };

    public static void Main()
    {
        var actual = new State(); // nothing exists yet
        var v1 = new State
        {
            ["vpc.main"] = new() { ["cidr"] = "10.0.0.0/16" }, ["subnet.app"] = new() { ["cidr"] = "10.0.1.0/24" },
            ["server.web-1"] = Web("small"), ["server.web-2"] = Web("small"), ["db.main"] = Db("postgres15", "20"),
        };
        Run("1. first apply", v1, actual);

        var v2 = Clone(v1);
        v2["server.web-1"]["size"] = "medium"; // in place
        v2.Remove("server.web-2"); v2["server.web-3"] = Web("small"); // a rename is a delete plus a create
        v2["db.main"]["engine"] = "postgres16"; // immutable: the database is replaced and its data is lost
        Run("2. edit the code", v2, actual);

        actual["server.web-1"]["size"] = "large"; // someone clicked in the console
        Run("3. drift: web-1 was resized by hand", v2, actual);
        Console.WriteLine("all invariants held");
    }
}
