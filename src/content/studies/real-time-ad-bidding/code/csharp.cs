// Budget pacing for one ad campaign across a day of bidding, simulated second by second, in C#.
// Three designs spend the same daily budget: no pacing, a pacer that hands each bidder node a local slice, and a
// central counter that every bid must reach. Then win notices that arrive twice are counted once by auction id.
// Money is in mills (thousandths of a dollar) so that every language does the same integer arithmetic.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    static readonly int[] Hourly = { 4, 3, 2, 2, 2, 3, 5, 7, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 10, 10, 10, 9, 7, 6 }; // traffic weight of each hour, 160 in all
    const long MillsPerWeightSecond = 25; // bidding on every matching request would spend 25 mills per second per unit of weight
    const int Day = 86400, Hour = 3600;
    const long Budget = 5000 * 1000; // $5,000 a day
    const int ReportDelay = 60; // spend reports reach the bidders and the pacer 60 seconds late
    static readonly long[] NodeShares = { 16, 16, 12, 12, 12, 12, 12, 8 }; // percent of the campaign's traffic seen by each of 8 bidder nodes
    const int CounterRegions = 4, LateRegions = 3; // a central counter in one of 4 regions; the other 3 are too far away to answer in time

    static long Rate(int s) => MillsPerWeightSecond * Hourly[s / Hour]; // spend per second if we bid on everything
    static readonly long[] PotentialFrom = new long[Day + 1]; // PotentialFrom[s] = spend possible from second s to midnight

    static string Clock(int s) => $"{s / Hour:D2}:{s % Hour / 60:D2}:{s % 60:D2}";
    static string Dollars(long m) => $"${m / 1000}.{m % 1000 / 10:D2}";

    // 1. No pacing: every node bids on everything until the spend it has heard about reaches the budget.
    static (long Total, int OutAt, int LastBid) NoPacing()
    {
        var spent = new List<long> { 0 }; // spent[s] = total spend before second s
        int outAt = -1, lastBid = -1;
        for (int s = 0; s < Day; s++)
        {
            long known = s >= ReportDelay ? spent[s - ReportDelay] : 0;
            long spend = known < Budget ? Rate(s) : 0;
            if (spend > 0) lastBid = s;
            spent.Add(spent[s] + spend);
            if (outAt < 0 && spent[s + 1] >= Budget) outAt = s + 1;
        }
        return (spent[Day], outAt, lastBid);
    }

    // 2. Local slices: every ReportDelay seconds a pacer splits the next slice of budget between the nodes in proportion to
    // their traffic. It plans with the newest report, which is one interval old. Each node spends its own slice with no network call.
    static (long Total, int LastBid, int Slices) LocalSlices()
    {
        var spent = new List<long> { 0 };
        var left = new long[NodeShares.Length];
        int lastBid = -1, slices = 0;
        for (int s = 0; s < Day; s++)
        {
            if (s % ReportDelay == 0)
            {
                long known = s >= ReportDelay ? spent[s - ReportDelay] : 0;
                int end = Math.Min(s + ReportDelay, Day);
                long slice = Math.Max(0, Budget - known) * (PotentialFrom[s] - PotentialFrom[end]) / PotentialFrom[s];
                left = NodeShares.Select(share => slice * share / 100).ToArray(); // an unspent slice is taken back
                slices++;
            }
            long spend = 0;
            for (int i = 0; i < NodeShares.Length; i++)
            {
                long supply = Rate(s) * NodeShares[i] / 100; // what this node could spend in this second
                long used = Math.Min(supply, left[i]);
                left[i] -= used;
                spend += used;
            }
            if (spend > 0) lastBid = s;
            spent.Add(spent[s] + spend);
        }
        return (spent[Day], lastBid, slices);
    }

    // 3. Central counter: exact, but a bid from a far region waits a long round trip and misses the exchange's deadline.
    static long CentralCounter()
    {
        long scaled = 0; // spend times CounterRegions, so a quarter of a mill is still a whole number
        for (int s = 0; s < Day; s++)
        {
            long target = Budget * (PotentialFrom[0] - PotentialFrom[s + 1]) / PotentialFrom[0]; // even plan
            long reachable = Rate(s) * (CounterRegions - LateRegions); // only the counter's own region answers in time
            scaled += Math.Max(0, Math.Min(reachable, target * CounterRegions - scaled));
        }
        return scaled / CounterRegions;
    }

    public static int Main()
    {
        for (int s = Day - 1; s >= 0; s--) PotentialFrom[s] = PotentialFrom[s + 1] + Rate(s);
        var a = NoPacing();
        var b = LocalSlices();
        long c = CentralCounter();
        Console.WriteLine($"bidding on everything would spend {Dollars(PotentialFrom[0])}; the budget is {Dollars(Budget)}");
        Console.WriteLine($"no pacing: out of budget at {Clock(a.OutAt)}, last bid at {Clock(a.LastBid)}, spent {Dollars(a.Total)} ({Dollars(a.Total - Budget)} over)");
        Console.WriteLine($"local slices: {b.Slices} slices to {NodeShares.Length} nodes, last bid at {Clock(b.LastBid)}, spent {Dollars(b.Total)} ({Dollars(Math.Max(0, b.Total - Budget))} over)");
        Console.WriteLine($"central counter, {LateRegions} of {CounterRegions} regions too far: spent {Dollars(c)} of {Dollars(Budget)}");

        // Win notices: the exchange calls the win URL again when it does not hear back in time, so some arrive twice.
        const int Wins = 10000, RetryEvery = 25;
        const long PriceMicros = 2600; // a $2.60 CPM is $0.0026 per impression
        var notices = new List<string>();
        for (int i = 0; i < Wins; i++)
        {
            notices.Add($"auction-{i}");
            if (i % RetryEvery == 0) notices.Add($"auction-{i}");
        }
        var seen = new HashSet<string>();
        int billed = 0;
        foreach (var id in notices) if (seen.Add(id)) billed++;
        string Micros(long n) => $"${n * PriceMicros / 1000000}.{n * PriceMicros % 1000000 / 10000:D2}";
        Console.WriteLine($"win notices received {notices.Count}: counted naively {Micros(notices.Count)}, counted once per auction {Micros(billed)}");

        if (a.OutAt >= 12 * Hour || b.Total > Budget * 101 / 100 || billed != Wins) return 1;
        return 0;
    }
}
