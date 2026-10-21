// A usage meter in C#: events arrive out of order and sometimes twice.
// We drop duplicates by event id, sum usage per customer and period by EVENT time,
// close each period after a grace time, and send late events to an adjustment.
using System;
using System.Collections.Generic;
using System.Linq;

const long Period = 1000, Grace = 100, Quota = 900;
(long Size, long Rate)[] tiers = { (1000, 10), (1000, 8), (long.MaxValue, 5) }; // units in tier, cents per unit

// Price of a total quantity, in cents (tiered: each tier is charged at its own rate).
long Cost(long units)
{
    long left = units, cents = 0;
    foreach (var (size, rate) in tiers) { long n = Math.Min(left, size); cents += n * rate; left -= n; }
    return cents;
}
string Money(long c) => $"{c / 100}.{c % 100:00}";

const int Events = 2000;
const int Customers = 3;
const int MaxQty = 5; // units per event: 1..5
const int LateIn10 = 2; // 2 events in 10 arrive up to 599 late, the rest within 19
const int LateMax = 600;
const int OnTimeMax = 20;
const int DupOneIn = 10; // one event in 10 is delivered twice
const int DupDelay = 50;
long seed = 7;
long Random(long n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 65536 % n; }

// Make 2,000 events over two periods. 1 in 5 is delayed a lot, and 1 in 10 is sent twice.
var stream = new List<Ev>();
for (int id = 0; id < Events; id++)
{
    long customer = Random(Customers), ts = Random(2 * Period), qty = 1 + Random(MaxQty);
    long delay = Random(10) < LateIn10 ? Random(LateMax) : Random(OnTimeMax);
    stream.Add(new Ev(id, customer, ts, qty, ts + delay));
    if (Random(DupOneIn) == 0) stream.Add(new Ev(id, customer, ts, qty, ts + delay + Random(DupDelay)));
}
stream = stream.OrderBy(e => e.Arrival).ThenBy(e => e.Id).ToList();

var seen = new HashSet<int>();
var live = new Dictionary<string, long>(); var snapshot = new Dictionary<string, long>();
var closed = new HashSet<long>(); var late = new Dictionary<string, long>(); var truth = new Dictionary<string, long>();
var crossed = new Dictionary<string, long>(); // "customer:period" -> arrival time when usage passed the quota
int duplicates = 0;
string Key(long c, long p) => $"{c}:{p}";
long Get(Dictionary<string, long> m, string k) => m.TryGetValue(k, out var v) ? v : 0;
void Add(Dictionary<string, long> m, string k, long q) => m[k] = Get(m, k) + q;

void CloseDue(long now) // close every period whose grace time has passed
{
    for (long p = 0; p < 2; p++)
        if (!closed.Contains(p) && (p + 1) * Period + Grace <= now)
        {
            for (long c = 0; c < Customers; c++) snapshot[Key(c, p)] = Get(live, Key(c, p));
            closed.Add(p);
        }
}

foreach (var ev in stream)
{
    CloseDue(ev.Arrival);
    if (!seen.Add(ev.Id)) { duplicates++; continue; }
    long p = ev.Ts / Period; string k = Key(ev.Customer, p);
    Add(truth, k, ev.Qty);
    if (closed.Contains(p)) { Add(late, k, ev.Qty); continue; } // the invoice is already out
    Add(live, k, ev.Qty);
    if (Get(live, k) > Quota && !crossed.ContainsKey(k)) crossed[k] = ev.Arrival;
}
CloseDue(long.MaxValue);

Console.WriteLine($"events {stream.Count}, unique {seen.Count}, duplicates dropped {duplicates}");
bool ok = true;
for (long p = 0; p < 2; p++)
    for (long c = 0; c < Customers; c++)
    {
        string k = Key(c, p); long billed = snapshot[k], extra = Get(late, k);
        long adj = Cost(billed + extra) - Cost(billed);
        Console.WriteLine($"period {p} customer {c}: invoiced {billed} units = {Money(Cost(billed))}, late {extra} units, adjustment {Money(adj)}");
        if (billed + extra != truth[k]) ok = false; // reconciliation against the raw unique events
    }
Console.WriteLine($"quota {Quota} crossed: " + string.Join(", ", crossed.OrderBy(e => e.Key, StringComparer.Ordinal).Select(e => $"{e.Key} at {e.Value}")));
Console.WriteLine($"reconciled: {(ok ? "true" : "false")}");
if (!ok || seen.Count + duplicates != stream.Count) return 1;
return 0;

record Ev(int Id, long Customer, long Ts, long Qty, long Arrival);
