// A client-side mesh proxy in C#: it balances by least request (power of two choices),
// ejects a pod after 5 errors in a row, and retries only while retries stay under 20% of the requests.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

public class Result
{
    public int Requests, Ok, Attempts, Retries, Ejections, Denied, BadBefore;
    public int[] Sent = new int[Mesh.Pods];
}

public static class Mesh
{
    public const int Pods = 5, Ticks = 300, PerTick = 2, BadPod = 3, BadFrom = 50, OutageFrom = 200, OutageTo = 220;
    public const int MaxRetries = 3, EjectAfter = 5, EjectTicks = 30;
    static readonly int[] Hold = { 2, 5, 2, 2, 2 }; // ticks a request stays in flight; pod 1 is slow
    static uint seed = 7;

    static int Random(int n) { seed = unchecked(seed * 1664525u + 1013904223u); return (int)((seed >> 16) % (uint)n); }

    public static Result Run(bool eject, bool budget)
    {
        seed = 7;
        var active = new int[Pods]; var consecutive = new int[Pods]; var ejectedUntil = new int[Pods];
        var releases = Enumerable.Range(0, Ticks + 10).Select(_ => new List<int>()).ToArray();
        var r = new Result();

        // Power of two choices: draw two candidate pods and take the one with fewer requests in flight.
        int Pick(int t, List<int> tried)
        {
            var pool = Enumerable.Range(0, Pods).Where(p => ejectedUntil[p] <= t && !tried.Contains(p)).ToList();
            if (pool.Count == 0) pool = Enumerable.Range(0, Pods).Where(p => !tried.Contains(p)).ToList(); // panic mode: use ejected pods too
            int a = pool[Random(pool.Count)], b = pool[Random(pool.Count)];
            return active[b] < active[a] ? b : a;
        }

        for (int t = 0; t < Ticks; t++)
        {
            foreach (var p in releases[t]) active[p]--;
            for (int i = 0; i < PerTick; i++)
            {
                r.Requests++;
                var tried = new List<int>();
                for (int k = 0; k <= MaxRetries; k++)
                {
                    int p = Pick(t, tried);
                    if (p == BadPod && t >= BadFrom && t < OutageFrom) r.BadBefore++; // attempts that reached the bad pod before the outage
                    r.Attempts++; r.Sent[p]++; active[p]++; releases[t + Hold[p]].Add(p);
                    bool down = (t >= OutageFrom && t < OutageTo) || (p == BadPod && t >= BadFrom);
                    if (!down) { consecutive[p] = 0; r.Ok++; break; }
                    consecutive[p]++;
                    if (eject && consecutive[p] >= EjectAfter) { ejectedUntil[p] = t + EjectTicks; consecutive[p] = 0; r.Ejections++; }
                    tried.Add(p);
                    if (k == MaxRetries) break;
                    if (budget && (r.Retries + 1) * 5 > r.Requests) { r.Denied++; break; } // the budget: retries <= 20% of requests
                    r.Retries++;
                }
            }
        }
        return r;
    }

    public static void Main()
    {
        var modes = new (string Name, bool Eject, bool Budget)[] { ("plain", false, false), ("eject", true, false), ("budget", false, true), ("eject+budget", true, true) };
        var result = new Dictionary<string, Result>();
        foreach (var (name, eject, budget) in modes)
        {
            var r = Run(eject, budget); result[name] = r;
            Console.WriteLine($"{name.PadRight(13)} ok {r.Ok}/{r.Requests}, attempts {r.Attempts}, retries {r.Retries}, denied {r.Denied}, ejections {r.Ejections}, per pod [{string.Join(", ", r.Sent)}]");
        }

        Result plain = result["plain"], eject2 = result["eject"], budget2 = result["budget"], both = result["eject+budget"];
        Console.WriteLine($"bad pod {BadPod} got {plain.BadBefore} attempts before the outage in plain mode and {eject2.BadBefore} with ejection");
        Console.WriteLine($"amplification: {((double)plain.Attempts / plain.Requests).ToString("F2", CultureInfo.InvariantCulture)} plain, {((double)both.Attempts / both.Requests).ToString("F2", CultureInfo.InvariantCulture)} with ejection and budget");

        bool[] checks = {
            eject2.BadBefore * 2 < plain.BadBefore,        // ejection stops most traffic to the bad pod
            budget2.Retries * 5 <= budget2.Requests,       // the budget bounds retries to 20% of requests
            both.Attempts < plain.Attempts,                // less wasted work
            plain.Ok > plain.Requests * 0.9 && both.Ok > 0, // retries still hide the one bad pod
        };
        if (checks.Contains(false)) { Console.WriteLine("invariant failed"); Environment.Exit(1); }
    }
}
