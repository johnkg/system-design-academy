// Four consumer styles over the same seeded crash schedule. Payment events are charged to a card API
// and recorded in a ledger. Intended final state: every payment charged once and recorded once.
using System;
using System.Collections.Generic;

const int N = 12;
int AmountOf(int i) => 10 + ((i * 7) % 30);

// Deterministic fault for (message, attempt): the same schedule hits every style. 25 % of attempts fail.
string Fault(int seed, int id, int attempt, int rate)
{
    uint x = unchecked((uint)seed * 7919u + (uint)id * 104729u + (uint)attempt * 1299709u + 12345u);
    for (int i = 0; i < 3; i++) x = unchecked(x * 1664525u + 1013904223u);
    if ((x >> 16) % 1000 >= (uint)rate) return "ok";
    uint s = (x >> 8) % 100;
    return s < 30 ? "crashBefore" : s < 55 ? "crashMid" : s < 80 ? "crashAfter" : "lostAck";
}

(int lost, int dupLedger, int dupCard, int ledgerTotal, int cardTotal, int want) Run(string style, int seed, int rate, bool cardKey)
{
    var ledger = new int[N]; var card = new int[N]; var seen = new HashSet<int>();
    void Charge(int i) { if (!(cardKey && card[i] > 0)) card[i]++; } // provider honours the key
    for (int id = 0; id < N; id++)
    {
        if (style == "ack-before")           // offset moves first: one try, no redelivery
        {
            var f0 = Fault(seed, id, 0, rate);
            if (f0 == "crashBefore") continue;   // lost
            Charge(id);
            if (f0 == "crashMid") continue;      // charged, never recorded, lost
            ledger[id]++;
            continue;
        }
        for (int attempt = 0; attempt < 50; attempt++)
        {
            var f = Fault(seed, id, attempt, rate);
            if (f == "crashBefore") continue;                     // redelivered
            if (style == "idempotent" && seen.Contains(id)) break; // unique key hit: skip and ack
            Charge(id);
            if (f == "crashMid") continue;                        // transaction never committed
            ledger[id]++;
            if (style == "idempotent") seen.Add(id);              // same transaction as the ledger row
            if (style == "transactional") break;                  // offset committed with the row
            if (f == "ok") break;                                 // ack arrived
        }                                                         // crashAfter / lostAck: redelivered
    }
    int lost = 0, dl = 0, dc = 0, lt = 0, ct = 0, want = 0;
    for (int i = 0; i < N; i++)
    {
        if (ledger[i] == 0) lost++;
        dl += Math.Max(0, ledger[i] - 1); dc += Math.Max(0, card[i] - 1);
        lt += ledger[i] * AmountOf(i); ct += card[i] * AmountOf(i); want += AmountOf(i);
    }
    return (lost, dl, dc, lt, ct, want);
}

void Show(string name, (int lost, int dupLedger, int dupCard, int ledgerTotal, int cardTotal, int want) r) =>
    Console.WriteLine($"{name.PadRight(14)} lost={r.lost} dupLedger={r.dupLedger} dupCard={r.dupCard} ledger={r.ledgerTotal} card={r.cardTotal} intended={r.want}");

void Must(bool c, string m) { if (!c) { Console.Error.WriteLine("FAILED: " + m); Environment.Exit(1); } }

string[] styles = { "ack-before", "ack-after", "idempotent", "transactional" };
var R = new Dictionary<string, (int lost, int dupLedger, int dupCard, int ledgerTotal, int cardTotal, int want)>();
foreach (var s in styles) { R[s] = Run(s, 1, 250, false); Show(s, R[s]); }
Console.WriteLine("-- card API honours an idempotency key --");
var K = new Dictionary<string, (int lost, int dupLedger, int dupCard, int ledgerTotal, int cardTotal, int want)>();
foreach (var s in styles) { K[s] = Run(s, 1, 250, true); Show(s, K[s]); }

Must(R["ack-before"].lost > 0, "ack-before loses messages");
Must(R["ack-before"].dupLedger == 0, "ack-before never duplicates");
Must(R["ack-after"].lost == 0 && R["ack-after"].dupLedger > 0, "ack-after loses nothing but duplicates");
Must(R["idempotent"].lost == 0 && R["idempotent"].ledgerTotal == R["idempotent"].want, "idempotent consumer reaches the intended ledger");
Must(R["idempotent"].dupCard > 0, "without a card key the external charge is still repeated");
Must(R["transactional"].lost == 0 && R["transactional"].dupLedger == 0, "transactional consumer has no duplicate ledger rows");
Must(K["idempotent"].cardTotal == K["idempotent"].want && K["idempotent"].ledgerTotal == K["idempotent"].want, "dedupe plus card key is exactly the intended state");
Must(K["transactional"].cardTotal == K["transactional"].want, "transactional plus card key is exactly the intended state");
Console.WriteLine("all invariants hold");
