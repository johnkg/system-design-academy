// IDOR (broken object-level authorization) in a toy invoice API with 8 endpoints and 20 invoices owned by 4 users.
// The attacker, bob (user 2), is logged in correctly. He owns 5 invoices and tries to reach the other 15.
// What to look for: "logged in" is not "allowed to see this object"; random ids hide the objects only until one endpoint
// (a list, a search, a bulk export, a leaked link) shows an id; checking a few handlers leaves the others open; and
// checking every row after fetching all rows is safe but reads the whole table.
// Fixed data and a seeded integer generator: the output never changes.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const int Bob = 2;
    static long state = 777;
    static int Owner(int i) => i % 4 + 1; // invoice i belongs to user (i mod 4) + 1
    static long Next() { state = state * 48271 % 2147483647; return state; } // MINSTD: the same sequence in every language
    static string Hex6() => (Next() % 16777216).ToString("x6");

    static List<string> MakeIds(string kind)
    {
        if (kind == "sequential") return Enumerable.Range(0, 20).Select(i => (1001 + i).ToString()).ToList();
        state = 777;
        return Enumerable.Range(0, 20).Select(_ => Hex6()).ToList();
    }

    record Endpoint(string Id, string Kind, string Effect);
    static readonly Endpoint[] Endpoints =
    {
        new("E1", "id", "read"),     // GET /invoices/{id}
        new("E2", "id", "change"),   // PUT /invoices/{id}
        new("E3", "id", "delete"),   // DELETE /invoices/{id}
        new("E4", "id", "read"),     // GET /invoices/{id}/pdf
        new("E5", "list", "read"),   // GET /invoices (list)
        new("E6", "list", "read"),   // GET /search?q=
        new("E7", "id", "read"),     // POST /invoices/export {ids}
        new("E8", "list", "read"),   // GET /users/{userId}/invoices
    };
    // Which endpoints verify that the invoice is bob's (or, for lists, scope the query to bob).
    static readonly string[] All = { "E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8" };
    static readonly Dictionary<string, string[]> Checked = new()
    {
        ["none"] = Array.Empty<string>(),
        ["scoped-lists"] = new[] { "E5", "E6", "E8" },
        ["some"] = new[] { "E1", "E2", "E3" },
        ["central"] = All,
        ["perrow"] = All,
    };

    static (Dictionary<string, int> Exposed, int Read, int Change, int Del, int GuessedValid) Attack(string auth, string idKind, bool leaked)
    {
        var invoiceIds = MakeIds(idKind);
        var foreign = invoiceIds.Where((_, i) => Owner(i) != Bob).ToList();
        // Guessing: sequential ids are all guessable; for random ids bob tries 2000 random 6-digit hex values.
        List<string> guessed;
        if (idKind == "sequential") guessed = foreign;
        else
        {
            var tries = Enumerable.Range(0, 2000).Select(_ => Hex6()).ToHashSet();
            guessed = foreign.Where(tries.Contains).ToList();
        }
        var candidates = new HashSet<string>(guessed);
        if (leaked) candidates.Add(foreign[0]); // one id seen in a shared link or a log line
        bool Open(Endpoint e) => !Checked[auth].Contains(e.Id);
        foreach (var e in Endpoints) if (e.Kind == "list" && Open(e)) candidates.UnionWith(foreign); // lists show ids
        // What one endpoint lets bob reach: a list shows every foreign invoice when unchecked, an id endpoint takes any id he has.
        List<string> Reach(Endpoint e) => !Open(e) ? new List<string>() : e.Kind == "list" ? foreign : candidates.ToList();
        var exposed = Endpoints.ToDictionary(e => e.Id, e => Reach(e).Count);
        int Count(string effect) => Endpoints.Where(e => e.Effect == effect).SelectMany(Reach).Distinct().Count();
        return (exposed, Count("read"), Count("change"), Count("delete"), guessed.Count);
    }

    public static void Main()
    {
        Console.WriteLine("bob owns 5 of 20 invoices; the other 15 belong to other users");
        var auths = new[] { "none", "scoped-lists", "some", "central", "perrow" };
        foreach (var auth in auths)
            foreach (var kind in new[] { "sequential", "random" })
            {
                var r = Attack(auth, kind, false);
                var per = string.Join(" ", Endpoints.Select(e => $"{e.Id} {r.Exposed[e.Id]}"));
                Console.WriteLine($"{auth} + {kind} ids: read {r.Read}, changed {r.Change}, deleted {r.Del} of 15 | {per} | valid guesses {r.GuessedValid}");
            }
        Console.WriteLine("one foreign id leaks (a shared link or a log line), random ids:");
        foreach (var auth in auths)
        {
            var r = Attack(auth, "random", true);
            Console.WriteLine($"  {auth}: read {r.Read}, changed {r.Change}, deleted {r.Del} of 15");
        }
        Console.WriteLine("cost of one list request by table size (own invoices are a quarter of the table):");
        foreach (int n in new[] { 20, 1000, 100000 })
            Console.WriteLine($"  {n} invoices: scoped query reads {n / 4} rows and makes 1 policy call; fetch-all-then-check reads {n} rows and makes {n} policy calls");
    }
}
