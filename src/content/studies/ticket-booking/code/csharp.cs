// Holding a seat without selling it twice in C#:
// a seat is claimed with one atomic step that checks and changes it together, and an unpaid hold expires by itself.
using System;
using System.Collections.Generic;
using System.Linq;

public class Seat
{
    public string? Holder;
    public int Expires;
    public bool Paid;
}

// The seat table. In a real database, Claim() is one statement:
//   UPDATE seats SET holder = ?, expires = ? WHERE id = ? AND (holder IS NULL OR expires <= now)
public class Seats
{
    const int HoldSeconds = 600;
    readonly Dictionary<string, Seat> rows;

    public Seats(IEnumerable<string> ids) { rows = ids.ToDictionary(id => id, id => new Seat()); }

    public bool Claim(string id, string user, int now)
    {
        var seat = rows[id];
        if (seat.Paid) return false;
        if (seat.Holder != null && seat.Expires > now) return false; // someone else holds it, and the hold is still running
        seat.Holder = user; seat.Expires = now + HoldSeconds; // check and change in one step
        return true;
    }

    // Payment arrived. Only the current holder, before the hold ran out, may turn the hold into a sale.
    public bool Confirm(string id, string user, int now)
    {
        var seat = rows[id];
        if (seat.Paid || seat.Holder != user || seat.Expires <= now) return false;
        seat.Paid = true;
        return true;
    }
}

public static class Program
{
    public static int Main()
    {
        // What goes wrong without it: check and change are two steps, and two buyers can both finish the first one.
        string? owner = null; int sales = 0;
        var buyers = new[] { "ann", "ben" };
        var seen = buyers.Select(_ => owner == null).ToArray(); // every buyer reads the seat: it looks free
        for (int i = 0; i < buyers.Length; i++) if (seen[i]) { owner = buyers[i]; sales++; } // then every buyer writes
        Console.WriteLine($"without an atomic claim: A1 was sold {sales} times");

        var seats = new Seats(new[] { "A1", "A2" });
        int t = 0;
        var results = new List<(string, bool)>
        {
            ("ann claims A1", seats.Claim("A1", "ann", t)),
            ("ben claims A1 at the same moment", seats.Claim("A1", "ben", t)),
            ("ben claims A2", seats.Claim("A2", "ben", t)),
        };
        t += 700; // ben never pays, and ten minutes pass
        results.Add(("ben tries to pay for A2 after his hold ran out", seats.Confirm("A2", "ben", t)));
        results.Add(("cat claims A2, now free again", seats.Claim("A2", "cat", t)));
        results.Add(("ann pays for A1 after 700 seconds", seats.Confirm("A1", "ann", t)));
        results.Add(("cat pays for A2", seats.Confirm("A2", "cat", t)));
        foreach (var (what, ok) in results) Console.WriteLine($"{(ok ? "yes" : "no ")}  {what}");

        bool[] expected = { true, false, true, false, true, false, true };
        return sales != 2 || results.Where((r, i) => r.Item2 != expected[i]).Any() ? 1 : 0;
    }
}
