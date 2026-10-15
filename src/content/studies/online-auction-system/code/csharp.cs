// An auction in C#: optimistic concurrency, proxy bidding, anti-sniping extension and an exactly-once close.
// All money is in whole units, so every language prints the same result.
using System;
using System.Collections.Generic;
using System.Linq;

const int Start = Auction.Start, Step = Auction.Step;
ulong seed = 77;
int Rnd(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)((seed / 65536) % (ulong)n); }

var a = new Auction { EndsAt = 1000 };
int ok = 0, conflicts = 0, low = 0;
void Tally(string r) { if (r == "ok") ok++; else if (r == "conflict") conflicts++; else if (r == "too low") low++; }

int now = 0, lastPrice = Start;
while (now < a.EndsAt)
{
    now += 10 + Rnd(25) + a.Extensions * 12;                 // bidders slow down as the fight goes on
    if (now >= a.EndsAt) break;
    int seen = a.Version;                                    // two bidders read the same version at once
    foreach (int bidder in new[] { Rnd(6), Rnd(6) })
    {
        int max = a.Price + Step * (1 + Rnd(8));
        string r = a.PlaceBid(bidder, max, now, seen);
        Tally(r);
        if (r == "conflict") { r = a.PlaceBid(bidder, max + Step, now, a.Version); Tally(r); } // retry with fresh state
        if (a.Price < lastPrice) throw new Exception("price went down");
        lastPrice = a.Price;
    }
}

var orders = new Dictionary<string, (int, int)>();
var closes = new[] { a.CloseOnce(orders), a.CloseOnce(orders), a.CloseOnce(orders) }; // three deliveries of the same job
// Oracle: the winner has the highest ceiling, and pays one step over the second highest (capped at their own ceiling).
var best = new Dictionary<int, int>();
foreach (var (bidder, m) in a.Accepted) if (!best.ContainsKey(bidder) || m > best[bidder]) best[bidder] = m;
var ceilings = best.Values.OrderByDescending(x => x).ToList();
int expected = ceilings.Count > 1 ? Math.Min(ceilings[0], ceilings[1] + Step) : Start;
Console.WriteLine($"accepted {ok}, conflicts {conflicts}, too low {low}, version {a.Version}");
Console.WriteLine($"ended at {a.EndsAt} after {a.Extensions} extensions");
Console.WriteLine($"winner #{a.Leader} pays {a.Price}, expected {expected}");
Console.WriteLine($"closes: {string.Join(",", closes.Select(c => c ? "true" : "false"))}; orders: {orders.Count}");
if (a.Price != expected || a.Version != ok || orders.Count != 1 || closes.Count(c => c) != 1) Environment.Exit(1);

class Auction
{
    public const int Start = 100, Step = 5, Window = 120, MaxExtensions = 8;
    public int Version, Price = Start, Leader = -1, LeaderMax, EndsAt, Extensions;
    public bool Settled;
    public List<(int, int)> Accepted = new();

    // A bid says "I will pay up to max". It is only applied if the version the bidder saw is still current.
    public string PlaceBid(int bidder, int max, int now, int seenVersion)
    {
        if (Settled || now >= EndsAt) return "closed";
        if (seenVersion != Version) return "conflict";         // someone else won the race: re-read and retry
        int floor = Leader < 0 ? Start : Price + Step;
        if (max < floor) return "too low";
        if (Leader < 0) { Leader = bidder; LeaderMax = max; }
        else if (bidder == Leader) LeaderMax = Math.Max(LeaderMax, max); // raising your own ceiling does not move the price
        else if (max > LeaderMax) { Price = Math.Min(max, LeaderMax + Step); Leader = bidder; LeaderMax = max; }
        else Price = Math.Min(LeaderMax, max + Step);             // the leader's proxy answers for them
        if (EndsAt - now < Window && Extensions < MaxExtensions) { EndsAt = now + Window; Extensions++; } // anti-sniping
        Version++;
        Accepted.Add((bidder, max));
        return "ok";
    }

    // The close job may be delivered several times. The first compare-and-set on "settled" wins.
    public bool CloseOnce(Dictionary<string, (int, int)> orders)
    {
        if (Settled) return false;
        Settled = true;
        orders["order-1"] = (Leader, Price);                   // keyed by auction, so a repeat could not add a second order
        return true;
    }
}
