// Message ordering vs scale-out: competing consumers against a key-partitioned log, with retries.
// A deterministic simulation (integer maths only, so every language prints the same numbers).
using System;
using System.Collections.Generic;
using System.Linq;

record Ev(int Id, int Key, int Seq, bool Deposit, int Amount, int Proc, int NFail);
class Item { public int Id; public int At; }
record Result(int Throughput, int Violations, int Overdrafts, int Hottest);

public static class Program
{
    const int Keys = 12, N = 240, Hot = 30, Parts = 4, Backoff = 5, Later = 30;
    const uint Seed = 42;
    const int MaxFails = 3, FailPct = 8; // up to 3 failed attempts, 8% each
    const int LowBalance = 20; // below this an account only receives deposits
    const int MinDeposit = 20, DepositSpread = 41, MinWithdrawal = 10; // deposits are 20..60
    const int MinProcMs = 6, ProcSpread = 9; // processing takes 6..14 ms
    const int MsPerS = 1000;

    static uint Fnv1a(string s) // 32-bit FNV-1a: the multiply is masked to 32 bits on purpose
    {
        uint h = 0x811c9dc5;
        foreach (var ch in s) { h ^= ch; h = unchecked(h * 0x01000193u); }
        return h;
    }

    static Func<uint> Rng(uint seed) // mulberry32, returns an unsigned 32-bit integer
    {
        uint a = seed;
        return () =>
        {
            unchecked
            {
                a += 0x6D2B79F5u;
                uint t = (a ^ (a >> 15)) * (a | 1);
                t ^= t + (t ^ (t >> 7)) * (t | 61);
                return t ^ (t >> 14);
            }
        };
    }

    static List<Ev> MakeStream() // account events; key 0 is the hot account (30% of traffic)
    {
        var next = Rng(Seed); var bal = new int[Keys]; var seq = new int[Keys]; var ev = new List<Ev>();
        for (int id = 0; id < N; id++)
        {
            uint u = next(), v = next(), w = next(), a = next(), p = next();
            int key = u % 100 < Hot ? 0 : 1 + (int)(v % (Keys - 1));
            int nfail = 0; bool ok = true;
            for (int j = 0; j < MaxFails; j++) { uint d = next(); if (ok && d % 100 < FailPct) nfail++; else ok = false; }
            bool deposit = bal[key] < LowBalance || w % 2 == 0;
            int amount = deposit ? MinDeposit + (int)(a % DepositSpread) : MinWithdrawal + (int)(a % (uint)(bal[key] - MinWithdrawal + 1)); // a withdrawal never exceeds the true balance
            bal[key] += deposit ? amount : -amount;
            ev.Add(new Ev(id, key, seq[key]++, deposit, amount, MinProcMs + (int)(p % ProcSpread), nfail));
        }
        return ev;
    }

    static Result Run(List<Ev> ev, bool partitioned, int consumers, string retry) // events arrive 1 ms apart
    {
        int nq = partitioned ? Parts : 1;
        var qs = Enumerable.Range(0, nq).Select(_ => new List<Item>()).ToArray();
        foreach (var e in ev) qs[partitioned ? (int)(Fnv1a("acct-" + e.Key) % Parts) : 0].Add(new Item { Id = e.Id, At = e.Id });
        var load = qs.Select(q => q.Count).ToArray(); var free = new int[consumers]; var done = new int[ev.Count]; var tries = new int[ev.Count];
        IEnumerable<int> Owns(int c) => partitioned ? Enumerable.Range(0, nq).Where(i => i % consumers == c) : new[] { 0 }; // a group owns whole partitions
        while (true)
        {
            int bc = -1, bq = 0, bs = 0, bat = 0; // the consumer that can start something earliest
            for (int c = 0; c < consumers; c++)
                foreach (var qi in Owns(c))
                {
                    if (qs[qi].Count == 0) continue;
                    var h = qs[qi][0]; int s = Math.Max(free[c], h.At);
                    if (bc < 0 || s < bs || (s == bs && h.At < bat)) { bc = c; bq = qi; bs = s; bat = h.At; }
                }
            if (bc < 0) break;
            var q = qs[bq]; var e = ev[q[0].Id]; int nf = retry == "none" ? 0 : e.NFail;
            if (retry == "later" && tries[e.Id] < nf) // failed: back of the line, after its successors
            {
                var item = q[0]; q.RemoveAt(0); tries[e.Id]++; free[bc] = bs + e.Proc; item.At = free[bc] + Later;
                int i = q.Count; while (i > 0 && q[i - 1].At > item.At) i--; q.Insert(i, item);
            }
            else // success, or retry in place (the partition is blocked until it works)
            {
                int n = retry == "later" ? 1 : nf + 1;
                free[bc] = done[e.Id] = bs + n * e.Proc + (n - 1) * Backoff; q.RemoveAt(0);
            }
        }
        var order = Enumerable.Range(0, ev.Count).OrderBy(i => done[i]).ThenBy(i => i);
        var top = Enumerable.Repeat(-1, Keys).ToArray(); var bal = new int[Keys]; int violations = 0, overdrafts = 0;
        foreach (var id in order)
        {
            var e = ev[id];
            if (e.Seq < top[e.Key]) violations++; else top[e.Key] = e.Seq; // finished after a later event of its key
            if (e.Deposit) bal[e.Key] += e.Amount; else if (bal[e.Key] >= e.Amount) bal[e.Key] -= e.Amount; else overdrafts++;
        }
        return new Result(ev.Count * MsPerS / done.Max(), violations, overdrafts, load.Max());
    }

    public static int Main()
    {
        var ev = MakeStream();
        Console.WriteLine($"acct-0 -> fnv1a {Fnv1a("acct-0")} -> partition {Fnv1a("acct-0") % Parts} of {Parts}");
        var cases = new (string, bool, int, string)[] {
            ("one queue, 1 consumer", false, 1, "none"), ("one queue, 4 competing", false, 4, "none"),
            ("by key, 4 partitions", true, 4, "none"), ("by key + retry in place", true, 4, "inplace"), ("by key + retry later", true, 4, "later") };
        var r = new Dictionary<string, Result>();
        foreach (var (name, part, cons, retry) in cases)
        {
            var x = r[name] = Run(ev, part, cons, retry);
            Console.WriteLine($"{name.PadRight(25)} {x.Throughput,4} ev/s  violations {x.Violations,2}  overdrafts {x.Overdrafts}  busiest queue {x.Hottest}");
        }
        var bad = new List<string>();
        if (r["one queue, 1 consumer"].Violations != 0) bad.Add("a single consumer must be ordered");
        if (r["one queue, 4 competing"].Violations == 0) bad.Add("competing consumers should reorder");
        if (r["by key, 4 partitions"].Violations != 0 || r["by key + retry in place"].Violations != 0) bad.Add("key partitioning must keep per-key order");
        if (r["by key + retry later"].Violations == 0) bad.Add("retry-later should reorder");
        if (r["one queue, 4 competing"].Throughput <= r["one queue, 1 consumer"].Throughput) bad.Add("competing consumers should scale");
        if (bad.Count > 0) { Console.Error.WriteLine(string.Join("; ", bad)); return 1; }
        Console.WriteLine("ok");
        return 0;
    }
}
