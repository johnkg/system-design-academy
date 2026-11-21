// Separation of concerns and layering: one small app (orders, invoices, customers) built four ways, hit by the same five changes.
// Look for: files edited per change, edits that only forward data ("forwarding"), and unrelated behaviour ("bystanders") inside edited files.
// A layer is (name, what it holds, what it only passes along). Every feature gets one file per layer, and each file calls the next layer down.
// Tokens: ui, rule, data (query shape), db (engine details), shape (the fields of a record, copied by every layer that maps it).
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    record Layer(string Name, string[] Holds, string[] Passes);
    record Mod(string Name, string[] Holds, string[] Passes, string[] Calls);
    record Change(string Text, string[] Touches);

    static readonly string[] Features = { "orders", "invoices", "customers" };

    static readonly (string Name, Layer[] Layers)[] Designs =
    {
        ("Leaky layers", new Layer[]
        {
            new("Controller", new[] { "ui", "data" }, new[] { "shape" }), // the screen code knows column names
            new("Service", new[] { "rule", "data" }, new[] { "shape" }), // the rules build queries
            new("Repository", new[] { "data", "db" }, new[] { "shape" }),
        }),
        ("Clean layers", new Layer[]
        {
            new("Controller", new[] { "ui" }, new[] { "shape" }),
            new("Service", new[] { "rule" }, new string[] { }),
            new("Repository", new[] { "data", "db" }, new[] { "shape" }),
        }),
        ("Vertical slices", new Layer[]
        {
            new("Slice", new[] { "ui", "rule", "data", "db" }, new string[] { }),
        }),
        ("Over-layered", new Layer[]
        {
            new("Controller", new[] { "ui" }, new[] { "shape" }),
            new("Facade", new string[] { }, new[] { "shape" }),
            new("Service", new[] { "rule" }, new[] { "shape" }),
            new("Manager", new[] { "rule" }, new[] { "shape" }),
            new("DomainModel", new string[] { }, new[] { "shape" }),
            new("Repository", new[] { "data" }, new[] { "shape" }),
            new("Dao", new[] { "data", "db" }, new[] { "shape" }),
        }),
    };

    static readonly Change[] Changes =
    {
        new("add a field to the order screen", new[] { "orders.ui", "orders.data", "orders.shape" }),
        new("change the order discount rule", new[] { "orders.rule" }),
        new("rename an invoice column", new[] { "invoices.data" }),
        new("swap the database engine", new[] { "orders.db", "invoices.db", "customers.db" }),
        new("restyle every screen", new[] { "orders.ui", "invoices.ui", "customers.ui" }),
    };

    static string Cap(string s) => char.ToUpper(s[0]) + s.Substring(1);

    static List<Mod> Build(Layer[] layers)
    {
        var mods = new List<Mod>();
        foreach (var f in Features)
        {
            for (int i = 0; i < layers.Length; i++)
            {
                var l = layers[i];
                string[] calls = i + 1 < layers.Length ? new[] { Cap(f) + layers[i + 1].Name } : new string[] { };
                mods.Add(new Mod(Cap(f) + l.Name, l.Holds.Select(t => f + "." + t).ToArray(), l.Passes.Select(t => f + "." + t).ToArray(), calls));
            }
        }
        return mods;
    }

    static (List<string> Edited, int Forwarding, int Bystanders, int Retest) Analyse(List<Mod> mods, string[] touches)
    {
        var edited = mods.Where(m => m.Holds.Concat(m.Passes).Any(t => touches.Contains(t))).ToList();
        var forwarding = edited.Where(m => !m.Holds.Any(t => touches.Contains(t))).ToList();
        int bystanders = 0;
        foreach (var m in edited) foreach (var t in m.Holds) if (!touches.Contains(t)) bystanders++;
        var retest = new HashSet<string>(edited.Select(m => m.Name));
        bool grew = true;
        while (grew) // anything that calls a retested file must be retested too
        {
            grew = false;
            foreach (var m in mods)
            {
                if (!retest.Contains(m.Name) && m.Calls.Any(c => retest.Contains(c))) { retest.Add(m.Name); grew = true; }
            }
        }
        return (edited.Select(m => m.Name).ToList(), forwarding.Count, bystanders, retest.Count);
    }

    public static void Main()
    {
        foreach (var (name, layers) in Designs)
        {
            var mods = Build(layers);
            Console.WriteLine($"== {name}: {mods.Count} files, {layers.Length} files on the path of one request");
            int te = 0, tf = 0, tb = 0, tr = 0;
            for (int i = 0; i < Changes.Length; i++)
            {
                var (edited, fwd, by, rt) = Analyse(mods, Changes[i].Touches);
                Console.WriteLine($"  C{i + 1} {Changes[i].Text}: edit {edited.Count} ({string.Join(", ", edited)}); forwarding {fwd}; bystander behaviours {by}; retest {rt}");
                te += edited.Count; tf += fwd; tb += by; tr += rt;
            }
            Console.WriteLine($"  five changes: {te} files edited, {tf} forwarding edits, {tb} bystander behaviours, {tr} retests");
        }
    }
}
