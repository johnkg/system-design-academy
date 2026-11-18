// Three ways a to-do app can handle 20 user actions: wait for the server, update optimistically, or work local-first.
// Fixed seed and integer maths only, so the output never changes.
using System;
using System.Collections.Generic;

public static class Program
{
    const int Actions = 20;
    const int UiMs = 16;               // time to redraw the screen from local state
    const int OfflineNoticeMs = 3000;  // a request that cannot reach the server is given up on after this long
    const long Seed = 2024;

    // Park-Miller generator: the same integers in every language.
    static Func<long> MakeRng(long seed)
    {
        long s = seed;
        return () => { s = (s * 48271) % 2147483647; return s; };
    }

    // Each action gets a latency jitter (0 to 30 percent) and a roll (0 to 99): the server fails it when roll < failure rate.
    static List<(int Jitter, int Roll)> Plan()
    {
        var next = MakeRng(Seed);
        var actions = new List<(int, int)>();
        for (int i = 0; i < Actions; i++)
        {
            int jitter = (int)(next() % 31);
            int roll = (int)(next() % 100);
            actions.Add((jitter, roll));
        }
        return actions;
    }

    // offlineAfter: the connection drops after this many actions, and the app is closed while still offline.
    static void Run(string mode, int latencyMs, int failPct, int offlineAfter)
    {
        int shownTotal = 0, rolledBack = 0, lost = 0, failed = 0, saved = 0, queued = 0;
        var plan = Plan();
        for (int i = 0; i < plan.Count; i++)
        {
            bool online = i < offlineAfter;
            int lat = latencyMs * (100 + plan[i].Jitter) / 100;
            bool fails = online && plan[i].Roll < failPct;
            if (fails) failed++;
            if (mode == "wait")
            {
                shownTotal += online ? lat : OfflineNoticeMs; // the screen changes only when the server answers
                if (online && !fails) saved++;
                if (!online) lost++;                          // typed, never sent, gone when the app closes
            }
            else if (mode == "optimistic")
            {
                shownTotal += UiMs;                           // the screen changes at once
                if (fails) rolledBack++;                      // ...and is wrong until the rejection arrives
                if (online && !fails) saved++;
                if (!online) lost++;                          // the user saw it applied, the pending request dies with the app
            }
            else
            {
                shownTotal += UiMs;                           // written to the local database, screen redrawn
                if (online) saved++;                          // failed requests stay in the queue and are retried
                else queued++;                                // still in the persisted queue when the app closes
            }
        }
        int avg = shownTotal / Actions;
        Console.WriteLine($"{mode.PadRight(10)} screen changes after {avg} ms on average; rolled back {rolledBack}; failed requests {failed}; on the server {saved}; lost on close {lost}; kept in queue {queued}");
    }

    public static void Main()
    {
        foreach (var (latency, fail) in new[] { (400, 15), (1200, 30) })
        {
            Console.WriteLine($"-- latency {latency} ms, server failures {fail}%, connection drops after action 14");
            foreach (var mode in new[] { "wait", "optimistic", "local" }) Run(mode, latency, fail, 14);
        }
    }
}
