// Stock as a ledger of movements, in C#:
// the balance is the sum of the movements, a reservation holds units until it expires or is paid,
// and a reservation is only granted if balance minus holds still covers it.
using System;
using System.Collections.Generic;
using System.Linq;


ulong seed = 7;
int Rnd(int n) { seed = (seed * 1664525UL + 1013904223UL) % 4294967296UL; return (int)((seed / 65536UL) % (ulong)n); }

var inv = new Inventory(2);
inv.Move(0, 60, "receipt", "po-1"); inv.Move(1, 40, "receipt", "po-2");
var physical = new[] { 60, 40 };                       // what is really on the shelves
int next = 0, rejected = 0, accepted = 0, sold = 0, expired = 0, late = 0;
var pending = new List<(string id, int payAt)>();
for (int now = 0; now < 200; now++)
{
    expired += inv.Expire(now);
    if (now == 100) { inv.Move(1, 150, "receipt", "po-3"); physical[1] += 150; } // a delivery arrives
    for (int k = 1 + Rnd(3); k > 0; k--)
    {
        string id = "r" + next++; int qty = 1 + Rnd(3);
        if (inv.Reserve(id, qty, now)) { accepted++; if (Rnd(100) < 65) pending.Add((id, now + 1 + Rnd(14))); } else rejected++;
    }
    foreach (var p in pending.Where(p => p.payAt == now).ToList())
    {
        var r = inv.Reservations[p.id];
        if (inv.Commit(p.id, now)) { sold += r.Qty; physical[r.Wh] -= r.Qty; } else late++;
    }
}
inv.Reserve("r0", 1, 200);                             // replay of an old id: no new hold
physical[1] -= 3;                                      // three units were damaged or stolen, and nobody recorded it

Console.WriteLine($"requests {next}: accepted {accepted}, rejected {rejected}");
Console.WriteLine($"units sold {sold}, holds expired {expired}, payments refused as late {late}");
Console.WriteLine($"lowest available ever: {inv.MinAvailable}");
for (int w = 0; w < 2; w++) Console.WriteLine($"warehouse {w}: balance {inv.Balance[w]}, held {inv.Held[w]}, shelf {physical[w]}");
for (int w = 0; w < 2; w++)
{
    int diff = physical[w] - inv.Balance[w];
    if (diff != 0) inv.Move(w, diff, "count", "cc-1");
    Console.WriteLine($"cycle count warehouse {w}: adjustment {diff}");
}
var replay = new int[2];
foreach (var e in inv.Ledger) replay[e.Wh] += e.Delta;
bool ok = Enumerable.Range(0, 2).All(w => replay[w] == inv.Balance[w] && replay[w] == physical[w]);
Console.WriteLine($"ledger entries {inv.Ledger.Count}; replay matches balances and shelves: {ok.ToString().ToLower()}");
if (inv.MinAvailable < 0 || !ok) Environment.Exit(1);

class Reservation { public int Wh, Qty, Expires; public string State = "held"; }
record Movement(int Wh, int Delta, string Kind, string Ref);

class Inventory
{
    public List<Movement> Ledger = new();                  // append-only
    public int[] Balance, Held;                            // projection of the ledger, and units promised to holds
    public Dictionary<string, Reservation> Reservations = new();
    public int MinAvailable = 0;
    public Inventory(int warehouses) { Balance = new int[warehouses]; Held = new int[warehouses]; }

    public void Move(int wh, int delta, string kind, string rf) { Ledger.Add(new Movement(wh, delta, kind, rf)); Balance[wh] += delta; }
    public int Available(int wh) => Balance[wh] - Held[wh];

    public bool Reserve(string id, int qty, int now)
    {
        if (Reservations.ContainsKey(id)) return true;     // a retry of the same request changes nothing
        int wh = -1;
        for (int w = 0; w < Balance.Length && wh < 0; w++) if (Available(w) >= qty) wh = w;
        if (wh < 0) return false;                          // the check and the hold are one step
        Held[wh] += qty;
        Reservations[id] = new Reservation { Wh = wh, Qty = qty, Expires = now + 10 };
        for (int w = 0; w < Balance.Length; w++) MinAvailable = Math.Min(MinAvailable, Available(w));
        return true;
    }

    public int Expire(int now)
    {
        int n = 0;
        foreach (var r in Reservations.Values)
            if (r.State == "held" && r.Expires <= now) { r.State = "expired"; Held[r.Wh] -= r.Qty; n++; }
        return n;
    }

    public bool Commit(string id, int now)
    {
        if (!Reservations.TryGetValue(id, out var r) || r.State != "held" || now >= r.Expires) return false; // too late
        r.State = "sold"; Held[r.Wh] -= r.Qty;
        Move(r.Wh, -r.Qty, "pick", id);
        return true;
    }
}
