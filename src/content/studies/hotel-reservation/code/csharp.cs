// A hotel booking core in C#: one inventory row per room type and night, an all-or-nothing conditional update across the nights of a stay,
// holds that expire, idempotent requests, and a small overbooking allowance.
using System;
using System.Collections.Generic;
using System.Linq;

public class Row { public int Sold, Held; }
public class Hold { public string State = ""; public int From, To, Expires; }

public class Inventory
{
    public const int Nights = 7, Capacity = 10, Overbook = 1, HoldTtl = 6; // 10 rooms of one type, one extra allowed, holds last 6 ticks
    readonly int limit;
    public readonly Row[] Rows = Enumerable.Range(0, Nights).Select(_ => new Row()).ToArray(); // one row per night
    public readonly Dictionary<string, Hold> Holds = new(); // idempotency key -> hold
    public int Replays;

    public Inventory(int limit) { this.limit = limit; }

    // UPDATE row SET held = held + 1 WHERE night = ? AND sold + held < limit, for each night. If any night fails, undo the ones that worked.
    public Hold TryHold(string key, int from, int to, int now)
    {
        if (Holds.TryGetValue(key, out var existing)) { Replays++; return existing; } // same key again: return the same answer
        var done = new List<int>();
        for (int n = from; n < to; n++)
        {
            var row = Rows[n];
            if (row.Sold + row.Held >= limit) { done.ForEach(d => Rows[d].Held--); return Remember(key, new Hold { State = "rejected" }); }
            row.Held++; done.Add(n);
        }
        return Remember(key, new Hold { State = "held", From = from, To = to, Expires = now + HoldTtl });
    }

    Hold Remember(string key, Hold hold) { Holds[key] = hold; return hold; }

    public bool Confirm(string key, int now) // payment succeeded
    {
        if (!Holds.TryGetValue(key, out var h) || h.State != "held" || now >= h.Expires) return false; // a late payment finds the hold gone
        for (int n = h.From; n < h.To; n++) { Rows[n].Held--; Rows[n].Sold++; }
        h.State = "sold";
        return true;
    }

    public int Expire(int now) // a sweeper gives back holds whose time ran out
    {
        int freed = 0;
        foreach (var h in Holds.Values)
            if (h.State == "held" && now >= h.Expires) { for (int n = h.From; n < h.To; n++) Rows[n].Held--; h.State = "expired"; freed++; }
        return freed;
    }
}

public record Request(string Key, int From, int To, bool Pays);

public static class Program
{
    static long seed = 4242;
    static int Random(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)((seed / 65536) % n); }

    public static int Main()
    {
        const int Nights = Inventory.Nights, Capacity = Inventory.Capacity;
        // 60 requests, one per tick. Each wants 1 to 3 nights, pays 2 ticks later unless it abandons, and every 7th request is sent twice.
        var requests = new List<Request>();
        for (int i = 0; i < 60; i++)
        {
            int len = 1 + Random(3), from = Random(Nights - len + 1);
            bool pays = Random(100) < 70;
            requests.Add(new Request($"req-{i}", from, from + len, pays));
        }

        // The mistake: everyone reads the free count first, then writes. Here 12 requests read the same snapshot.
        var naive = new int[Nights];
        for (int i = 0; i < requests.Count; i += 12)
        {
            var snapshot = (int[])naive.Clone();
            foreach (var r in requests.Skip(i).Take(12))
            {
                bool free = true;
                for (int n = r.From; n < r.To; n++) if (snapshot[n] >= Capacity) free = false;
                if (free) for (int n = r.From; n < r.To; n++) naive[n]++;
            }
        }
        int naiveOver = naive.Sum(x => Math.Max(0, x - Capacity));

        var inv = new Inventory(Capacity + Inventory.Overbook);
        var pending = new List<(string Key, int At)>();
        int rejected = 0, sold = 0, expired = 0;
        for (int t = 0; t < requests.Count + Inventory.HoldTtl + 2; t++)
        {
            expired += inv.Expire(t);
            foreach (var p in pending.Where(p => p.At == t).ToList()) if (inv.Confirm(p.Key, t)) sold++;
            if (t < requests.Count)
            {
                var r = requests[t];
                var h = inv.TryHold(r.Key, r.From, r.To, t);
                if (h.State == "rejected") rejected++; else if (r.Pays) pending.Add((r.Key, t + 2));
                if (t % 7 == 0) inv.TryHold(r.Key, r.From, r.To, t); // a client retry with the same key
            }
        }

        var usage = inv.Rows.Select(row => row.Sold + row.Held).ToArray();
        Console.WriteLine($"read then write: nights sold beyond {Capacity} rooms = {naiveOver}");
        Console.WriteLine($"conditional update: sold {sold}, rejected {rejected}, holds expired {expired}, retries replayed {inv.Replays}");
        Console.WriteLine($"rooms used per night: {string.Join(" ", usage)} (limit {Capacity + Inventory.Overbook})");

        // Overbooking: guests who cancel or do not show up leave rooms empty, and the allowance sells them twice.
        var sold10 = inv.Rows.Select(row => row.Sold).ToArray();
        // Pretend that 0%, 10% or 20% of the guests booked for a night do not arrive, depending on the night.
        var shown = sold10.Select((s, i) => (s * (10 - (i % 3)) + 5) / 10).ToArray();
        int walked = shown.Sum(x => Math.Max(0, x - Capacity));
        Console.WriteLine($"sold per night: {string.Join(" ", sold10)}; guests who arrive: {string.Join(" ", shown)}; guests without a room: {walked}");

        if (naiveOver == 0) return 1;
        if (usage.Any(u => u > Capacity + Inventory.Overbook)) return 1;
        if (inv.Rows.Any(row => row.Held != 0)) return 1; // every hold ended as sold or expired
        return 0;
    }
}
