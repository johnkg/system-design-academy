// A tiny feature store in C#:
// one feature definition feeds an offline log and an online store, and training labels are joined "as of" their own time.
using System;
using System.Collections.Generic;
using System.Linq;

ulong seed = 7;
int Random(int n) { seed = (seed * 1664525UL + 1013904223UL) % 4294967296UL; return (int)((seed / 65536UL) % (ulong)n); }

// Raw purchase events: the source of truth. Time only moves forward.
var events = new List<Ev>();
for (int i = 0, t = 0; i < 300; i++) { t += 1 + Random(5); int u = Random(6); int a = 1 + Random(100); events.Add(new Ev(u, t, a)); }

// The single feature definition: per user, total spend and purchase count so far.
// The offline log and the online store both use it, so they cannot drift apart.
List<Row> ComputeRows(List<Ev> list)
{
    var state = new Dictionary<int, (int Sum, int Count)>();
    var rows = new List<Row>();
    foreach (var e in list)
    {
        var s = state.GetValueOrDefault(e.User);
        s = (s.Sum + e.Amount, s.Count + 1);
        state[e.User] = s;
        rows.Add(new Row(e.User, e.Ts, s.Sum, s.Count));
    }
    return rows;
}

var offline = ComputeRows(events); // append-only history of every feature value, with the time it became true

// Online store: only the newest value per user. Delivery is out of order here, so a write with an older time is ignored.
var online = new Dictionary<int, Row>();
var delivery = offline.ToList();
for (int i = 0; i + 1 < delivery.Count; i += 3) (delivery[i], delivery[i + 1]) = (delivery[i + 1], delivery[i]);
foreach (var r in delivery) { if (!online.TryGetValue(r.User, out var cur) || r.Ts >= cur.Ts) online[r.User] = r; }

// Point-in-time join: the last row of this user whose time is at or before the label time (binary search).
(int Sum, int Count) AsOf(int user, int ts)
{
    var rows = offline.Where(r => r.User == user).ToList();
    int lo = 0, hi = rows.Count;
    while (lo < hi) { int mid = (lo + hi) >> 1; if (rows[mid].Ts <= ts) lo = mid + 1; else hi = mid; }
    return lo == 0 ? (0, 0) : (rows[lo - 1].Sum, rows[lo - 1].Count);
}
// The naive join takes the newest row, which includes the future.
(int Sum, int Count) Latest(int user) => (online[user].Sum, online[user].Count);

// Ground truth, recomputed from the raw events seen up to the label time.
(int Sum, int Count) Truth(int user, int ts)
{
    var mine = events.Where(e => e.User == user && e.Ts <= ts).ToList();
    return (mine.Sum(e => e.Amount), mine.Count);
}

var labels = new List<(int User, int Ts)>();
for (int i = 0; i < 40; i++) { int u = Random(6); int t = 50 + Random(700); labels.Add((u, t)); }
int naiveWrong = 0, pitWrong = 0;
foreach (var l in labels)
{
    var tr = Truth(l.User, l.Ts); var p = AsOf(l.User, l.Ts); var n = Latest(l.User);
    if (p != tr) pitWrong++;
    if (n != tr) naiveWrong++;
}
var l0 = labels[1];
Console.WriteLine($"events: {events.Count}, feature rows: {offline.Count}, online keys: {online.Count}");
Console.WriteLine($"label 1 (user {l0.User} at t={l0.Ts}): truth sum {Truth(l0.User, l0.Ts).Sum}, as-of {AsOf(l0.User, l0.Ts).Sum}, naive latest {Latest(l0.User).Sum}");
Console.WriteLine($"labels with a wrong feature: as-of {pitWrong}, naive latest {naiveWrong} of {labels.Count}");

bool same = online.All(kv => kv.Value.Sum == offline.Last(x => x.User == kv.Key).Sum);
bool again = ComputeRows(events).SequenceEqual(offline); // a backfill from the raw events gives the same table
Console.WriteLine($"online equals the newest offline row: {(same ? "true" : "false")}; backfill repeats exactly: {(again ? "true" : "false")}");
if (pitWrong != 0 || naiveWrong == 0 || !same || !again) Environment.Exit(1);

record Ev(int User, int Ts, int Amount);
record Row(int User, int Ts, int Sum, int Count);
