// Cloud cost: the same web service priced several ways. Prices are cents per server-hour; everything is integers.
// Load is how many right-sized servers the traffic needs in each hour of a day.
using System;
using System.Linq;

public static class Program
{
    static readonly int[] Load = { 4, 3, 3, 3, 3, 4, 6, 9, 12, 14, 15, 16, 16, 15, 15, 14, 13, 12, 11, 10, 9, 7, 6, 5 };
    const int OnDemand = 20;     // cents per right-sized server-hour, pay as you go
    const int Committed = 12;    // 40% off, but paid every hour for the committed servers, used or not
    const int Spot = 6;          // 70% off spare capacity that the provider can take back
    const int ReclaimEvery = 20; // about 1 spot hour in 20 is taken back and rerun at the on-demand price
    const int TestServers = 6;   // a test environment, also billed on demand
    const int Days = 30;

    static int Headroom(int load) => (load * 5 + 3) / 4; // run 25% above the load (rounded up), so a spike does not hurt

    record Bill(long Month, long Committed, long OnDemand, long Spot, long Test, int Used, int Paid);

    static Bill Price(bool large, bool autoscale, int commit, bool spot, int testHours)
    {
        int size = large ? 2 : 1; // a large server costs twice as much and is half idle
        int peak = Headroom(Load.Max());
        long committed = 0, onDemand = 0, spotCost = 0; int spotHours = 0, used = 0, paid = 0;
        foreach (int load in Load)
        {
            int run = autoscale ? Headroom(load) : peak;
            committed += commit * Committed * size;
            int extra = Math.Max(0, run - commit);
            if (spot) { spotHours += extra; spotCost += extra * Spot * size; } else onDemand += extra * OnDemand * size;
            used += load;
            paid += Math.Max(run, commit) * size;
        }
        onDemand += spotHours / ReclaimEvery * OnDemand * size;
        long test = TestServers * testHours * OnDemand * size;
        long day = committed + onDemand + spotCost + test;
        return new Bill(day * Days, committed * Days, onDemand * Days, spotCost * Days, test * Days, used, paid);
    }

    static string Dollars(long cents) => $"${cents / 100}.{cents % 100:D2}";

    static long Show(string name, bool large, bool autoscale, int commit, bool spot, int testHours)
    {
        var p = Price(large, autoscale, commit, spot, testHours);
        Console.WriteLine($"-- {name}");
        Console.WriteLine($"  month {Dollars(p.Month)}: committed {Dollars(p.Committed)}, on demand {Dollars(p.OnDemand)}, spot {Dollars(p.Spot)}, test environment {Dollars(p.Test)}");
        Console.WriteLine($"  utilization {p.Used * 100 / p.Paid}% ({p.Used} of {p.Paid} server-hours a day do work)");
        if (p.Month != p.Committed + p.OnDemand + p.Spot + p.Test) throw new Exception("the parts must add up to the bill");
        return p.Month;
    }

    public static void Main()
    {
        long start = Show("large servers, fixed for the peak, all on demand, test always on", large: true, autoscale: false, commit: 0, spot: false, testHours: 24);
        Show("right-sized", large: false, autoscale: false, commit: 0, spot: false, testHours: 24);
        Show("right-sized, autoscaled", large: false, autoscale: true, commit: 0, spot: false, testHours: 24);
        Show("right-sized, autoscaled, commit to 4 servers, burst on spot, test off at night", large: false, autoscale: true, commit: 4, spot: true, testHours: 12);
        long over = Show("the same, but commit to 20 servers", large: false, autoscale: true, commit: 20, spot: true, testHours: 12);
        if (over >= start) throw new Exception("the over-commitment should still be cheaper than the start here");
    }
}
