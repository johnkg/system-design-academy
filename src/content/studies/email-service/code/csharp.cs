// An outbound mail scheduler in C#:
// one shared queue versus a queue per receiving domain, with retries, suppression of hard bounces and a sender reputation.
using System;
using System.Collections.Generic;
using System.Linq;

public record Domain(string Name, int Weight, int Limit, int Hard, int Soft); // share of the list, messages accepted per minute, percent of missing addresses, percent of attempts deferred

public class Msg { public int Id, D, Tries, Next; public bool Done; }

public record Result(int Sent, int Skipped, int Delivered, int Hard, int Expired, int Throttled, int Blocked, int Deferred, int Minutes, int OverLimit, int Rep)
{
    public double Reputation => Rep / 10.0;
}

public static class Mail
{
    public static readonly Domain[] Domains =
    {
        new("gmail.com", 50, 30, 3, 5), new("yahoo.com", 25, 20, 4, 5), new("corp.example", 15, 5, 2, 10), new("tiny.org", 10, 3, 5, 5),
    };
    static int Mix(int id) => (int)(unchecked((uint)id * 2654435761u) >> 16);
    public static int DomainOf(int id) { int r = Mix(id) % 100; for (int d = 0; d < Domains.Length; d++) { if (r < Domains[d].Weight) return d; r -= Domains[d].Weight; } return 0; }
    static bool Exists(int id) => Mix(id + 7919) % 100 >= Domains[DomainOf(id)].Hard; // fixed per address, so a bad address always bounces

    public static Result Run(string mode, int[] ids, HashSet<int> suppressed, int startRep = 1000)
    {
        ulong seed = 99;
        int Roll() { seed = (seed * 1664525UL + 1013904223UL) % 4294967296UL; return (int)((seed / 65536UL) % 100UL); }
        var msgs = ids.Where(id => !suppressed.Contains(id)).Select(id => new Msg { Id = id, D = DomainOf(id) }).ToList();
        int sent = msgs.Count, skipped = ids.Length - msgs.Count, delivered = 0, hard = 0, expired = 0, throttled = 0, blocked = 0, deferred = 0, minutes = 0, overLimit = 0;
        int rep = startRep; // reputation in tenths of a point; it falls fast and recovers slowly, so inside one send it only falls
        int pending = msgs.Count;
        for (int minute = 0; pending > 0 && minute < 400; minute++)
        {
            minutes = minute + 1;
            var used = new int[Domains.Length];
            int budget = Math.Min(60, 12 + minute); // the new IP is warmed up: its minute budget grows every minute
            void Fail(Msg m) { m.Tries++; if (m.Tries >= 5) { m.Done = true; pending--; expired++; } else m.Next = minute + (1 << m.Tries); } // wait 2, 4, 8, 16 minutes
            void Attempt(Msg m)
            {
                used[m.D]++;
                if (used[m.D] > Domains[m.D].Limit) { throttled++; rep -= 10; Fail(m); }  // 421: slow down
                else if (rep < 600) { blocked++; Fail(m); }                              // 550: we are on a blocklist
                else if (!Exists(m.Id)) { hard++; rep -= 10; suppressed.Add(m.Id); m.Done = true; pending--; }
                else if (Roll() < Domains[m.D].Soft) { deferred++; Fail(m); }            // 451: try again later
                else { delivered++; m.Done = true; pending--; }
            }
            var ready = msgs.Where(m => !m.Done && m.Next <= minute).ToList();
            if (mode == "shared")
            {
                foreach (var m in ready) { if (budget-- <= 0) break; Attempt(m); }
            }
            else
            {
                var queues = Enumerable.Range(0, Domains.Length).Select(d => new Queue<Msg>(ready.Where(m => m.D == d))).ToArray();
                for (bool progress = true; budget > 0 && progress;)
                {
                    progress = false;
                    for (int d = 0; d < Domains.Length && budget > 0; d++)
                        if (used[d] < Domains[d].Limit && queues[d].Count > 0) { Attempt(queues[d].Dequeue()); budget--; progress = true; }
                }
            }
            for (int d = 0; d < Domains.Length; d++) if (mode == "perDomain" && used[d] > Domains[d].Limit) overLimit++;
        }
        return new Result(sent, skipped, delivered, hard, expired, throttled, blocked, deferred, minutes, overLimit, rep);
    }

    static void Show(string label, Result r) =>
        Console.WriteLine($"{label}: delivered {r.Delivered}, hard bounces {r.Hard}, gave up {r.Expired}, 421 throttled {r.Throttled}, 550 blocked {r.Blocked}, 451 deferred {r.Deferred}, skipped {r.Skipped}, reputation {r.Reputation}, {r.Minutes} min");

    public static int Main()
    {
        var ids = Enumerable.Range(0, 600).ToArray();
        var shared = Run("shared", ids, new HashSet<int>());
        var per = Run("perDomain", ids, new HashSet<int>());
        Show("shared queue    ", shared);
        Show("queue per domain", per);

        var list = new HashSet<int>();
        var first = Run("perDomain", ids, list); // the hard bounces of this send fill the suppression list, and the second send starts with this send's reputation
        var again = Run("perDomain", ids, new HashSet<int>(list), first.Rep);
        var noList = Run("perDomain", ids, new HashSet<int>(), first.Rep);
        Show("second send with suppression", again);
        Show("second send without it      ", noList);

        int Total(Result r) => r.Delivered + r.Hard + r.Expired;
        bool ok = Total(shared) + shared.Skipped == 600 && Total(per) + per.Skipped == 600 && per.Throttled == 0 && per.OverLimit == 0 && shared.Throttled > 0
            && again.Hard == 0 && again.Skipped == first.Hard && noList.Blocked > 0 && again.Delivered > noList.Delivered && again.Reputation > noList.Reputation && per.Reputation > shared.Reputation;
        Console.WriteLine($"invariants hold: {ok.ToString().ToLowerInvariant()}");
        return ok ? 0 : 1;
    }
}
