// 30 notifications are sent over one day through a platform push service to one phone that is offline for a while,
// and to a fleet of 1,000 device tokens, some of them stale. Minutes and integers only; the seed is fixed.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const int MinutesPerDay = 1440;
    const int Notifications = 30;
    const int OfflineStart = 300;  // the phone loses its connection at 05:00
    const int Fleet = 1000;

    record Note(int T, string Kind, int Jitter);

    static Func<long> MakeRng(long seed)
    {
        long s = seed;
        return () => { s = (s * 48271) % 2147483647; return s; };
    }

    // One notification about every 48 minutes. About 4 in 10 are "score updates" (newer ones make older ones pointless).
    static List<Note> Stream()
    {
        var next = MakeRng(83);
        var list = new List<Note>();
        for (int k = 0; k < Notifications; k++)
        {
            int t = k * 48 + (int)(next() % 48);
            string kind = next() % 10 < 4 ? "score" : "message";
            int jitter = (int)(next() % 16); // how long a normal-priority message waits for the device to be reachable, in minutes
            list.Add(new Note(t, kind, jitter));
        }
        return list;
    }

    // ttl: minutes the platform holds an undelivered message. collapse: score updates share a collapse key.
    // priority: "high" wakes the device at once; "normal" may wait for it. stalePct: share of the fleet's tokens that are dead.
    static void Run(int offlineMin, int ttl, bool collapse, string priority, int stalePct)
    {
        int reconnect = Math.Min(OfflineStart + offlineMin, MinutesPerDay);
        int delivered = 0, expired = 0, collapsed = 0, delaySum = 0;
        var pending = new List<Note>();
        foreach (var n in Stream())
        {
            if (n.T >= OfflineStart && n.T < reconnect) { pending.Add(n); continue; } // the platform holds it
            delivered++;                                                                // device reachable: delivered now
            delaySum += priority == "high" ? n.Jitter % 2 : n.Jitter;
        }
        int lastScore = collapse ? pending.Where(n => n.Kind == "score").Select(n => n.T).Append(-1).Max() : -1;
        foreach (var n in pending)
        {
            if (collapse && n.Kind == "score" && n.T != lastScore) { collapsed++; continue; } // replaced by a newer one with the same key
            if (reconnect - n.T > ttl) { expired++; continue; }                                // held longer than the TTL: dropped
            delivered++;
            delaySum += reconnect - n.T;
        }
        int avgDelay = delaySum / delivered;
        // The fleet: every notification is sent to every token. A dead token gets an "invalid token" answer from the platform.
        int stale = Fleet * stalePct / 100;
        int sends = Notifications * Fleet;
        int wastedKeep = Notifications * stale; // never removed: the same dead tokens are tried for every notification
        int wastedPrune = stale;                // removed after the first "invalid" answer
        Console.WriteLine($"offline {offlineMin} min, TTL {ttl} min, collapse {(collapse ? "on" : "off")}, {priority} priority, {stalePct}% stale");
        Console.WriteLine($"  phone: delivered {delivered}, expired {expired}, collapsed {collapsed}; average delay {avgDelay} min; {pending.Count} held while offline");
        Console.WriteLine($"  fleet: {sends} sends, {stale} dead tokens; wasted sends {wastedKeep} without pruning, {wastedPrune} with pruning");
        if (delivered + expired + collapsed != Notifications) throw new Exception("every notification must be accounted for");
    }

    public static void Main()
    {
        Run(240, 120, false, "normal", 10);
        Run(240, 120, true, "normal", 10);
        Run(240, 480, true, "normal", 10);
        Run(240, 120, false, "high", 10);
        Run(600, 60, false, "normal", 25);
    }
}
