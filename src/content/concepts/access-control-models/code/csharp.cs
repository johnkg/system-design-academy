// A tiny ReBAC evaluator (relation tuples, userset rewrites, bounded graph walk) next to an RBAC check.
// Both must give the same answers as the intent: members view their team's docs, leads edit them,
// the contractor dave views one document, and alice's note is private.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    static readonly (string Id, string Team, string Title)[] Users = { ("alice", "eng", "lead"), ("bob", "eng", "member"), ("carol", "finance", "lead"), ("dan", "finance", "member"), ("dave", "", "contractor") };
    static readonly (string Id, string Team)[] Docs = { ("eng/plan", "eng"), ("eng/spec", "eng"), ("finance/spec", "finance"), ("alice-notes", "") };

    // ---- ReBAC: tuples are (object, relation, subject) ----
    static readonly (string O, string R, string S)[] Tuples = {
        ("group:eng", "member", "user:alice"), ("group:eng", "member", "user:bob"),
        ("group:finance", "member", "user:carol"), ("group:finance", "member", "user:dan"),
        ("folder:eng", "editor", "user:alice"), ("folder:eng", "viewer", "group:eng#member"),
        ("folder:finance", "editor", "user:carol"), ("folder:finance", "viewer", "group:finance#member"),
        ("folder:eng/specs", "parent", "folder:eng"), ("folder:finance/specs", "parent", "folder:finance"),
        ("doc:eng/plan", "parent", "folder:eng"), ("doc:eng/spec", "parent", "folder:eng/specs"),
        ("doc:finance/spec", "parent", "folder:finance/specs"),
        ("doc:eng/spec", "viewer", "user:dave"), ("doc:alice-notes", "editor", "user:alice"),
    };
    static readonly Dictionary<string, List<(string O, string R, string S)>> Index = new();
    static string Fmt((string O, string R, string S) t) => $"{t.O}#{t.R}@{t.S}";

    const int DefaultMaxDepth = 8; // hops a check may follow before it gives up
    // Rewrites: viewer = direct + editor + parent->viewer; editor = direct + parent->editor; group member = direct.
    // Every tuple followed costs one hop, and the walk stops at maxDepth, so a cycle or a deep tree cannot run away.
    static List<string>? Walk(string obj, string rel, string user, int used, int maxDepth)
    {
        var own = Index.GetValueOrDefault(obj + "#" + rel) ?? new();
        foreach (var t in own) if ((t.S == "user:" + user || t.S == "user:*") && used + 1 <= maxDepth) return new() { Fmt(t) };
        foreach (var t in own)
        {
            if (!t.S.Contains('#') || used + 1 > maxDepth) continue;
            var parts = t.S.Split('#');
            var sub = Walk(parts[0], parts[1], user, used + 1, maxDepth);
            if (sub != null) { sub.Insert(0, Fmt(t)); return sub; }
        }
        if (obj.StartsWith("group:")) return null;
        if (rel == "viewer") { var sub = Walk(obj, "editor", user, used, maxDepth); if (sub != null) return sub; }
        foreach (var t in Index.GetValueOrDefault(obj + "#parent") ?? new())
        {
            if (used + 1 > maxDepth) continue;
            var sub = Walk(t.S, rel, user, used + 1, maxDepth);
            if (sub != null) { sub.Insert(0, Fmt(t)); return sub; }
        }
        return null;
    }
    static List<string>? Rebac(string user, string act, string doc, int maxDepth = DefaultMaxDepth) => Walk("doc:" + doc, act == "edit" ? "editor" : "viewer", user, 0, maxDepth);

    // ---- RBAC: roles hold (action, pattern); users hold roles ----
    static readonly Dictionary<string, (string Act, string Pat)> Roles = new() {
        ["eng-viewer"] = ("view", "eng/"), ["eng-editor"] = ("edit", "eng/"), ["finance-viewer"] = ("view", "finance/"),
        ["finance-editor"] = ("edit", "finance/"), ["eng-spec-viewer"] = ("view", "eng/spec"), ["notes-owner"] = ("edit", "alice-notes") };
    static readonly Dictionary<string, string[]> Held = new() {
        ["alice"] = new[] { "eng-editor", "notes-owner" }, ["bob"] = new[] { "eng-viewer" }, ["carol"] = new[] { "finance-editor" },
        ["dan"] = new[] { "finance-viewer" }, ["dave"] = new[] { "eng-spec-viewer" } };
    static string? Rbac(string user, string act, string doc)
    {
        foreach (var r in Held.GetValueOrDefault(user) ?? Array.Empty<string>())
        {
            var (a, pat) = Roles[r];
            if ((a == "edit" || act == "view") && (pat.EndsWith('/') ? doc.StartsWith(pat) : doc == pat)) return r;
        }
        return null;
    }

    static bool Intended(string user, string act, string doc)
    {
        var u = Users.First(x => x.Id == user); var d = Docs.First(x => x.Id == doc);
        if (doc == "alice-notes") return user == "alice";
        if (u.Team != "" && u.Team == d.Team) return act == "view" || u.Title == "lead";
        return user == "dave" && doc == "eng/spec" && act == "view";
    }

    public static int Main()
    {
        foreach (var t in Tuples) { var k = t.O + "#" + t.R; if (!Index.ContainsKey(k)) Index[k] = new(); Index[k].Add(t); }
        var questions = new[] { ("alice", "edit", "eng/spec"), ("bob", "view", "eng/plan"), ("bob", "edit", "eng/plan"), ("dan", "view", "finance/spec"), ("dan", "view", "eng/plan"), ("dave", "view", "eng/spec"), ("dave", "view", "eng/plan"), ("bob", "view", "alice-notes") };
        foreach (var (u, a, d) in questions)
        {
            var p = Rebac(u, a, d); var r = Rbac(u, a, d);
            Console.WriteLine($"{u} {a} {d}: want={(Intended(u, a, d) ? "allow" : "deny")} rebac={(p != null ? "allow" : "deny")} hops={(p != null ? p.Count : 0)} rbac={(r != null ? "allow" : "deny")} via {r ?? "-"}");
        }
        Console.WriteLine("path: " + string.Join(" > ", Rebac("dan", "view", "finance/spec")!));
        foreach (var depth in new[] { 3, 4 }) Console.WriteLine($"dan view finance/spec with depth {depth}: {(Rebac("dan", "view", "finance/spec", depth) != null ? "allow" : "deny (fail closed)")}");

        int pairs = 0;
        foreach (var u in Users) foreach (var d in Docs) foreach (var a in new[] { "view", "edit" })
        {
            var want = Intended(u.Id, a, d.Id);
            if ((Rebac(u.Id, a, d.Id) != null) != want || (Rbac(u.Id, a, d.Id) != null) != want) { Console.WriteLine($"MISMATCH {u.Id} {a} {d.Id}"); return 1; }
            pairs++;
        }
        Console.WriteLine($"{pairs} pairs agree; {Tuples.Length} tuples vs {Roles.Count} roles + {Held.Values.Sum(v => v.Length)} assignments");
        return 0;
    }
}
