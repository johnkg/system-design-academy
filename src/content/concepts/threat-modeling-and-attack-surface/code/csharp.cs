// Threat modeling for a toy photo-sharing app: a list of threats (one per data flow, tagged with a STRIDE letter),
// scored as likelihood x impact, and a list of fixes that each remove one or more threats.
// What to look for: a model drawn only around the easy-to-list public endpoints reports "0 risk left" while about half
// of the real risk is still there, and one fix can remove threats in two different flows.
// Everything is a fixed integer table, so the output never changes. Scores are 1 to 5 and are judgement calls, not measurements.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    record Threat(string Id, string Flow, string Stride, int Like, int Impact, int Scope);
    record Fix(string Id, string Name, int Cost, string[] Removes);

    // scope 1 = public endpoints, 2 = adds data stores and internal services, 3 = adds admin, third parties, build, backups
    static readonly Threat[] Threats =
    {
        new("t1", "login endpoint", "S", 5, 4, 1),
        new("t2", "photo by id endpoint", "I", 4, 4, 1),
        new("t3", "upload endpoint", "D", 4, 2, 1),
        new("t4", "comment form", "T", 3, 3, 1),
        new("t5", "import photo from URL", "E", 3, 5, 2),
        new("t6", "app to database", "I", 2, 5, 2),
        new("t7", "job queue to workers", "T", 3, 4, 2),
        new("t8", "application logs", "I", 4, 3, 2),
        new("t9", "admin panel", "E", 3, 5, 3),
        new("t10", "dependencies and CI", "T", 2, 5, 3),
        new("t11", "backup bucket", "I", 2, 5, 3),
        new("t12", "who deleted a photo", "R", 3, 2, 3),
    };
    static readonly Fix[] Fixes =
    {
        new("F1", "MFA and login rate limits", 3, new[] { "t1", "t9" }),
        new("F2", "owner check on every photo read", 2, new[] { "t2" }),
        new("F3", "upload size and type limits", 1, new[] { "t3" }),
        new("F4", "encode output", 1, new[] { "t4" }),
        new("F5", "egress allow-list for the importer", 2, new[] { "t5" }),
        new("F6", "least-privilege database account", 2, new[] { "t6" }),
        new("F7", "authenticate service-to-service calls", 3, new[] { "t7" }),
        new("F8", "scrub logs and keep an audit trail", 2, new[] { "t8", "t12" }),
        new("F9", "pin dependencies, scope CI secrets", 2, new[] { "t10" }),
        new("F10", "private, encrypted backup bucket", 1, new[] { "t11" }),
    };

    static int Risk(Threat t) => t.Like * t.Impact;
    static int Total(IEnumerable<Threat> items) => items.Sum(Risk);

    // How to order the fixes: "value" = visible risk removed per unit of cost, "biggest" = fix the single worst threat first,
    // "cheap" = cheapest first (the easy wins feel productive). Ties go to the fix listed first.
    static List<Fix> Order(List<Threat> visible, string ranking)
    {
        int Gain(Fix f) => Total(visible.Where(t => f.Removes.Contains(t.Id)));
        int Top(Fix f) => visible.Where(t => f.Removes.Contains(t.Id)).Select(Risk).Append(0).Max();
        Comparison<Fix> cmp = ranking switch
        {
            "value" => (a, b) => Gain(b) * a.Cost - Gain(a) * b.Cost,
            "biggest" => (a, b) => Top(b) - Top(a),
            _ => (a, b) => a.Cost - b.Cost,
        };
        var list = Fixes.Where(f => Gain(f) > 0).ToList();
        list.Sort((a, b) => { int c = cmp(a, b); return c != 0 ? c : Array.IndexOf(Fixes, a) - Array.IndexOf(Fixes, b); });
        return list;
    }

    public static void Main()
    {
        int all = Total(Threats);
        Console.WriteLine($"threats: {Threats.Length}, total risk {all}");
        for (int s = 1; s <= 3; s++)
        {
            var v = Threats.Where(t => t.Scope <= s).ToList();
            Console.WriteLine($"scope {s}: {v.Count} threats seen, risk seen {Total(v)}, risk not seen {all - Total(v)}");
        }
        foreach (var ranking in new[] { "value", "biggest", "cheap" })
            foreach (int budget in new[] { 5, 8, 19 })
                for (int scope = 1; scope <= 3; scope++)
                {
                    var visible = Threats.Where(t => t.Scope <= scope).ToList();
                    int left = budget;
                    var picked = new List<Fix>();
                    foreach (var f in Order(visible, ranking)) if (f.Cost <= left) { picked.Add(f); left -= f.Cost; }
                    var gone = picked.SelectMany(f => f.Removes).ToHashSet();
                    int realLeft = Total(Threats.Where(t => !gone.Contains(t.Id)));
                    int seenLeft = Total(visible.Where(t => !gone.Contains(t.Id)));
                    int removed = all - realLeft;
                    Console.WriteLine($"{ranking} budget {budget} scope {scope}: spent {budget - left}, model says left {seenLeft}, really left {realLeft}, removed {removed} ({100 * removed / all}%), fixes {string.Join(",", picked.Select(f => f.Id))}");
                }
    }
}
