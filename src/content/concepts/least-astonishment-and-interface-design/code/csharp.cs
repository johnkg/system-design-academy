// Least astonishment and interface design. Part 1 runs four real interfaces, each in a version that invites misuse and one that
// does not, against a caller who guessed from the names: positional boolean flags, a destructive default, a getter with a hidden
// side effect, and a name that hides an in-place change. Part 2 is a small model of 20 callers who read names only (level 0), the
// signature (level 1) or the docs (level 2), and counts mistaken calls and damage per design. Look for: each caller doing what
// the name suggested while the code did something else, and the over-explicit design that trades surprise for noise.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    // 1. Positional boolean flags: the caller means header=yes, compress=no.
    static readonly (string, int)[] Rows = { ("tea", 3), ("milk", 12) };

    static string ExportBad((string, int)[] rows, bool compress, bool header)
    {
        var lines = rows.Select(r => $"{r.Item1},{r.Item2}").ToList();
        if (header) lines.Insert(0, "name,qty");
        var s = string.Join("|", lines);
        return compress ? "gz:" + s : s;
    }
    static string ExportGood((string, int)[] rows, bool header = false, bool compress = false) => ExportBad(rows, compress, header);

    // 2. Surprising default: the caller deletes a directory they believe is empty.
    static string DeleteBad(Dictionary<string, string> fs, string path, bool recursive = true)
    {
        var gone = fs.Keys.Where(p => p.StartsWith(path + "/")).ToList();
        foreach (var p in gone) fs.Remove(p);
        return $"deleted {gone.Count} files";
    }
    static string DeleteGood(Dictionary<string, string> fs, string path, bool recursive = false)
    {
        var inside = fs.Keys.Where(p => p.StartsWith(path + "/")).ToList();
        if (inside.Count > 0 && !recursive) return $"refused: {inside.Count} files inside";
        foreach (var p in inside) fs.Remove(p);
        return $"deleted {inside.Count} files";
    }

    // 3. Hidden side effect: the caller checks whether a user exists.
    static string GetUserBad(List<string> users, string name) // creates the user when missing
    {
        if (!users.Contains(name)) users.Add(name);
        return name;
    }
    static string FindUser(List<string> users, string name) => users.Contains(name) ? name : null;

    // 4. A name that hides an in-place change: the caller expects a sorted copy.
    static List<int> GetSortedBad(List<int> xs)
    {
        xs.Sort();
        return xs;
    }
    static List<int> SortedCopy(List<int> xs) => xs.OrderBy(x => x).ToList();

    // Part 2. 20 callers per team, as counts at attention level 0 (names only), 1 (signature), 2 (documentation).
    // A hazard is noticed only by a caller who reads at least `need` levels deep: flags need 1, the others 2.
    // inviting: callers below `need` are surprised. least astonishing: the name, type or default shows the hazard, need 0.
    // over-explicit: every option must be spelled out, so nobody is surprised by a default, but callers who only read names
    //   paste the dangerous settings (weight 3 or more) from the nearest example.
    static readonly Dictionary<string, int[]> Teams = new()
    {
        ["careful"] = new[] { 0, 5, 15 }, ["mixed"] = new[] { 8, 8, 4 }, ["hurried"] = new[] { 16, 3, 1 },
    };
    static readonly (string, int, int)[] Hazards = { ("flags", 1, 1), ("default", 2, 5), ("side effect", 2, 3), ("name", 2, 2) }; // (label, need, damage if it bites)

    static int Astonished(string design, string team, int need, int weight)
    {
        var counts = Teams[team];
        if (design == "inviting") return counts.Take(need).Sum();
        if (design == "least") return 0;
        return weight >= 3 ? counts[0] : 0;
    }
    static int Words(string design, bool flags, int present)
    {
        if (design == "inviting") return 2 + (flags ? 2 : 0);
        return design == "least" ? 2 : 2 + 3 * present;
    }

    public static void Main()
    {
        Console.WriteLine($"flags: export(rows, true, false) gave '{ExportBad(Rows, true, false)}'; named call gave " +
            $"'{ExportGood(Rows, header: true, compress: false)}'");

        var fs1 = new Dictionary<string, string> { ["/a/x"] = "1", ["/a/y"] = "2", ["/b/z"] = "3" };
        var fs2 = new Dictionary<string, string>(fs1);
        var d1 = DeleteBad(fs1, "/a");
        var d2 = DeleteGood(fs2, "/a");
        Console.WriteLine($"default: delete('/a') {d1}, {fs1.Count} left; safe default {d2}, {fs2.Count} left");

        var u1 = new List<string> { "ann", "bob", "cy" };
        var u2 = new List<string> { "ann", "bob", "cy" };
        bool e1 = GetUserBad(u1, "zed") != null;
        bool e2 = FindUser(u2, "zed") != null;
        Console.WriteLine($"side effect: get_user('zed') says exists {e1.ToString().ToLower()} and users are now {u1.Count}; " +
            $"find_user says exists {e2.ToString().ToLower()} and users stay {u2.Count}");

        var l1 = new List<int> { 3, 1, 2 };
        var l2 = new List<int> { 3, 1, 2 };
        GetSortedBad(l1);
        SortedCopy(l2);
        Console.WriteLine($"name: after get_sorted the caller's list is {string.Join(",", l1)}; after sorted_copy it is {string.Join(",", l2)}");

        foreach (var team in new[] { "careful", "mixed", "hurried" })
            foreach (var design in new[] { "inviting", "least", "over" })
            {
                int mistaken = Hazards.Sum(h => Astonished(design, team, h.Item2, h.Item3));
                int damage = Hazards.Sum(h => Astonished(design, team, h.Item2, h.Item3) * h.Item3);
                Console.WriteLine($"{team} team, {design}: mistaken calls {mistaken}, damage {damage}, arguments per call {Words(design, true, 4)}");
            }
        foreach (var (name, need, weight) in Hazards)
        {
            int a = Astonished("inviting", "mixed", need, weight);
            Console.WriteLine($"mixed team, {name} alone: {a} surprised, damage {a * weight}");
        }
    }
}
