// A strangler migration, request by request. 200 customers, 4,000 requests. A share of customers is routed to a new
// service with its own database; the monolith keeps the rest. Reads and writes hit one store or the other, and the
// two stores are kept in step by one of four methods. Legacy reports (30% of reads) always read the monolith's
// database. Everything is integers from a seeded generator, so the output never changes.
using System;
using System.Collections.Generic;

class Program
{
    const int Customers = 200, Ticks = 4000;
    const int WritePct = 30;      // share of requests that update a customer
    const int LegacyPct = 30;     // share of reads done by legacy modules that only know the monolith database
    const int DualFailPct = 10;   // dual writes: the second write silently fails this often
    const int Lag = 12;           // outbox relay: requests between a write and its copy arriving
    const int CheckEvery = 1000;  // parity check: compare and repair every this many requests
    const int RollbackAt = 2400;  // the request at which a rollback happens, if asked for
    static readonly int[] Changes = { 800, 1600, 2400, 3200 };
    const int ChangeLen = 80;     // schema changes: owners alternate, the other side breaks

    static void Run(string name, int pct, string mode, bool parity, bool rollback)
    {
        long seed = 12345;
        long Rnd() { seed = (seed * 48271) % 2147483647; return seed; }
        var truth = new int[Customers];
        var oldDb = new int[Customers];
        var newDb = new int[Customers];
        var relay = new List<(int due, int c, int v, bool toNew)>();
        int reads = 0, wrong = 0, failed = 0, found = 0, lastRate = 0, behind = 0;
        bool rolled = false;
        for (int t = 0; t < Ticks; t++)
        {
            int c = (int)(Rnd() % Customers);
            bool isWrite = Rnd() % 100 < WritePct, legacy = Rnd() % 100 < LegacyPct, lose = Rnd() % 100 < DualFailPct;
            for (int i = relay.Count - 1; i >= 0; i--)
            {
                var m = relay[i];
                if (m.due <= t)
                {
                    var db = m.toNew ? newDb : oldDb;
                    db[m.c] = Math.Max(db[m.c], m.v);
                    relay.RemoveAt(i);
                }
            }
            if (rollback && t == RollbackAt)
            {
                rolled = true;
                for (int i = 0; i < Customers; i++) if (oldDb[i] != truth[i]) behind++;
            }
            bool onNew = !rolled && (c * 7919) % 100 < pct;
            string side = !isWrite && legacy ? "old" : onNew ? "new" : "old";
            int k = -1;
            for (int i = 0; i < Changes.Length; i++) if (t >= Changes[i] && t < Changes[i] + ChangeLen) { k = i; break; }
            if (mode == "shared" && pct > 0 && k >= 0 && side == (k % 2 == 0 ? "new" : "old")) failed++;
            else if (isWrite)
            {
                int v = ++truth[c];
                var own = onNew ? newDb : oldDb;
                var other = onNew ? oldDb : newDb;
                own[c] = v;
                if (pct == 0) { /* nothing to keep in step */ }
                else if (mode == "shared") other[c] = v;
                else if (mode == "none") { /* the new service owns the data, nothing is copied */ }
                else if (mode == "dual") { if (!lose) other[c] = Math.Max(other[c], v); }
                else relay.Add((t + Lag, c, v, !onNew));
            }
            else
            {
                reads++;
                int seen = side == "new" ? newDb[c] : oldDb[c];
                if (seen != truth[c]) wrong++;
            }
            if (parity && pct > 0 && (t + 1) % CheckEvery == 0)
            {
                int diff = 0;
                for (int i = 0; i < Customers; i++)
                    if (oldDb[i] != newDb[i]) { diff++; oldDb[i] = newDb[i] = Math.Max(oldDb[i], newDb[i]); }
                found += diff;
                lastRate = diff * 100 / Customers;
            }
        }
        int drift = 0; // with nothing moved there is no second store to compare
        for (int i = 0; i < Customers; i++) if (oldDb[i] != newDb[i]) drift++;
        if (pct == 0) drift = 0;
        int coordinated = mode == "shared" && pct > 0 ? Changes.Length : 0;
        Console.WriteLine($"-- {name}");
        Console.WriteLine($"  wrong reads: {wrong} of {reads}; failed requests during schema changes: {failed} ({coordinated} releases needed both teams)");
        Console.WriteLine($"  customers out of sync at the end: {drift} of {Customers}; parity checks found {found} (last check {lastRate}%)");
        Console.WriteLine($"  rollback: {(rollback ? behind + " customers had updates the monolith never received" : "not used")}");
    }

    static void Main()
    {
        Run("nothing moved", 0, "dual", false, false);
        Run("50% moved, no copy between the databases", 50, "none", false, false);
        Run("50% moved, dual writes, no checks", 50, "dual", false, false);
        Run("50% moved, shared database kept for now", 50, "shared", false, false);
        Run("50% moved, outbox relay", 50, "outbox", false, false);
        Run("50% moved, dual writes, parity check and repair", 50, "dual", true, false);
        Run("50% moved, dual writes, rollback at 2400", 50, "dual", false, true);
        Run("100% moved, outbox relay, parity check, rollback at 2400", 100, "outbox", true, true);
    }
}
