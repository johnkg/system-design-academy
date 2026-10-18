// A dispute engine in C#: idempotent notices, a state machine, durable deadlines, evidence packing and ledger entries.
// Money is in cents and time is in whole days, so the run is deterministic.
using System;
using System.Collections.Generic;
using System.Linq;

public class Dispute
{
    public string Id { get; set; } = "";
    public int Amount { get; set; }
    public string State { get; set; } = "opened";
    public int Due { get; set; }
    public bool Refunded { get; set; }
}
public class Entry { public string Did { get; set; } = ""; public string Kind { get; set; } = ""; public int Cents { get; set; } }
public class Store
{
    public List<Dispute> Disputes { get; set; } = new();
    public List<string> Seen { get; set; } = new();
    public List<Entry> Ledger { get; set; } = new();
    public List<string> Refunded { get; set; } = new();
}
public record Notice(string Nid, string Type, string Did, int Amount = 0, int Due = 0);
public record Item(string Name, int Kb);

public static class Engine
{
    static readonly Dictionary<string, string[]> Allowed = new()
    {
        ["opened"] = new[] { "evidence_requested", "accepted", "lost" },
        ["evidence_requested"] = new[] { "evidence_submitted", "accepted", "lost" },
        ["evidence_submitted"] = new[] { "won", "lost" },
        ["won"] = new string[0], ["lost"] = new string[0], ["accepted"] = new string[0],
    };
    public const int Fee = 1500;      // the network's dispute fee, charged when a dispute opens
    public const int LimitKb = 4500;  // the network's cap on the whole evidence packet

    static void Post(Store s, string did, string kind, int cents) => s.Ledger.Add(new Entry { Did = did, Kind = kind, Cents = cents });
    public static Dispute? Find(Store s, string did) => s.Disputes.FirstOrDefault(d => d.Id == did);

    // A state change is allowed only along the table. The ledger effect belongs to the change, so the two cannot drift apart.
    public static bool Move(Store s, Dispute d, string to)
    {
        if (!Allowed[d.State].Contains(to)) return false;
        d.State = to;
        if (to == "won") Post(s, d.Id, "reversal", d.Amount);
        return true;
    }

    public static string Ingest(Store s, Notice n)
    {
        if (s.Seen.Contains(n.Nid)) return "duplicate, ignored";   // the same notice arrives by webhook and again in the batch file
        s.Seen.Add(n.Nid);
        if (n.Type == "opened")
        {
            s.Disputes.Add(new Dispute { Id = n.Did, Amount = n.Amount, Due = n.Due, Refunded = s.Refunded.Contains(n.Did) });
            Post(s, n.Did, "provisional debit", -n.Amount);
            Post(s, n.Did, "fee", -Fee);
            return $"created, respond by day {n.Due}";
        }
        var d = Find(s, n.Did);
        if (d == null) return "unknown dispute";
        return Move(s, d, n.Type) ? $"now {n.Type}" : $"rejected {n.Type} while {d.State}";
    }

    // Fill the packet in priority order and skip whatever does not fit.
    public static string Submit(Store s, string did, int day, List<Item> items)
    {
        var d = Find(s, did)!;
        if (d.State != "evidence_requested" || day > d.Due) return "too late or wrong state";
        int used = 0, count = 0;
        foreach (var it in items) if (used + it.Kb <= LimitKb) { used += it.Kb; count++; }
        Move(s, d, "evidence_submitted");
        return $"{count} of {items.Count} items, {used} KB of {LimitKb}";
    }

    // A refund of a disputed charge would pay the customer twice, so it waits until the dispute is won.
    public static string Refund(Store s, string did)
    {
        var d = Find(s, did);
        if (d != null && d.State != "won") return $"blocked, dispute is {d.State}";
        s.Refunded.Add(did); return "allowed";
    }

    // The sweeper reads only stored deadlines, so it gives the same answer after a restart.
    public static List<string> Sweep(Store s, int today)
    {
        var output = new List<string>();
        foreach (var d in s.Disputes)
        {
            if (d.State != "opened" && d.State != "evidence_requested") continue;
            if (d.Due < today) { Move(s, d, "lost"); output.Add($"{d.Id} lost, deadline day {d.Due} missed"); }
            else if (d.Due - today <= 2) output.Add($"{d.Id} reminder, {d.Due - today} days left");
        }
        return output;
    }
}

public static class Program
{
    static void Say(string label, string text) => Console.WriteLine($"{label}: {text}");

    // Stands in for reading the rows back from the database: every object is rebuilt from plain values.
    static Store Reload(Store s) => new()
    {
        Disputes = s.Disputes.Select(d => new Dispute { Id = d.Id, Amount = d.Amount, State = d.State, Due = d.Due, Refunded = d.Refunded }).ToList(),
        Seen = new List<string>(s.Seen),
        Ledger = s.Ledger.Select(e => new Entry { Did = e.Did, Kind = e.Kind, Cents = e.Cents }).ToList(),
        Refunded = new List<string>(s.Refunded),
    };

    public static int Main()
    {
        var store = new Store();
        Say("refund dp_4 before any dispute", Engine.Refund(store, "dp_4"));
        var n1 = new Notice("n1", "opened", "dp_1", 8000, 7);
        var feed = new List<Notice>
        {
            n1, n1, new("n2", "evidence_requested", "dp_1"), new("n3", "opened", "dp_2", 2500, 8),
            new("n4", "evidence_requested", "dp_2"), new("n5", "opened", "dp_3", 4000, 9),
            new("n6", "evidence_requested", "dp_3"), new("n7", "opened", "dp_4", 1200, 10),
        };
        foreach (var n in feed) Say($"{n.Nid} {n.Did}", Engine.Ingest(store, n));
        Say("refund dp_1 while open", Engine.Refund(store, "dp_1"));
        var items = new List<Item> { new("receipt", 300), new("delivery proof", 1200), new("chat log", 2800), new("device log", 900), new("photos", 1500) };
        Say("submit dp_1 on day 3", Engine.Submit(store, "dp_1", 3, items));
        Say("accept dp_3", Engine.Move(store, Engine.Find(store, "dp_3")!, "accepted") ? "accepted" : "refused");
        Say("n8 dp_3", Engine.Ingest(store, new Notice("n8", "won", "dp_3")));
        store = Reload(store); // restart: nothing is kept in memory, everything comes back from stored rows
        Say("restart", $"{store.Disputes.Count} disputes reloaded");
        foreach (var line in Engine.Sweep(store, 6)) Say("sweep day 6", line);
        foreach (var line in Engine.Sweep(store, 11)) Say("sweep day 11", line);
        Say("n9 dp_1", Engine.Ingest(store, new Notice("n9", "won", "dp_1")));

        var net = store.Ledger.GroupBy(e => e.Did).ToDictionary(g => g.Key, g => g.Sum(e => e.Cents));
        foreach (var d in store.Disputes) Console.WriteLine($"{d.Id} {d.State} net {net[d.Id]}{(d.Refunded ? " (refunded first)" : "")}");
        int total = net.Values.Sum();
        Console.WriteLine($"merchant balance change {total}");
        bool ok = net["dp_1"] == -Engine.Fee && net["dp_2"] == -2500 - Engine.Fee && net["dp_3"] == -4000 - Engine.Fee
            && net["dp_4"] == -1200 - Engine.Fee && total == -13700 && store.Ledger.Count == 9;
        return ok ? 0 : 1;
    }
}
