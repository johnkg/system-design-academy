// A miniature of three ideas from Shopify's flash-sale posts, in C# (a teaching model, not Shopify's code or data):
// 1. pods: every request goes to exactly one pod, so one broken pod does not break the other shops,
// 2. a fair checkout queue: a threshold on arrival order that is corrected each tick by the unused room in the bucket,
// 3. protecting a slow dependency: a limit on workers waiting on it, and a circuit breaker.
// Everything is deterministic and uses whole numbers, so every run prints the same thing.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    public static int Main()
    {
        // ---- 1. Pods ----
        var podOf = new Dictionary<string, int> { ["shop-a"] = 1, ["shop-b"] = 1, ["shop-c"] = 2, ["shop-d"] = 2, ["shop-e"] = 3 }; // the "Sorting Hat" rules, as a table
        var podsDown = new HashSet<int> { 2 };

        Console.WriteLine("== Pods: pod 2 loses its database ==");
        foreach (var (shop, pod) in podOf)
            Console.WriteLine($"{shop} -> pod {pod}: {(podsDown.Contains(pod) ? "unavailable" : "ok")}");
        int shopCount = podOf.Count;
        int served = podOf.Keys.Count(s => !podsDown.Contains(podOf[s]));
        Console.WriteLine($"shops served: {served} of {shopCount}");
        // Without pods, an action that visits every shard fails for everyone as soon as one shard is down.
        Console.WriteLine($"an action that needs every pod: {(podsDown.Count == 0 ? shopCount : 0)} of {shopCount}");

        // ---- 2. A fair checkout queue ----
        // Buyers 1..10 arrive in that order. Each tick the bucket lets LIMIT buyers through. The threshold is an arrival
        // number: only buyers at or below it may try the bucket. Each tick it moves by the room left, a proportional-only correction.
        Console.WriteLine("== Fair queue: limit 3 per tick ==");
        const int Limit = 3;
        var waiting = new List<int> { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 };
        int threshold = 0;
        var admitted = new List<int>();
        for (int tick = 1; tick <= 4; tick++)
        {
            if (tick == 2) waiting = waiting.Where(n => n != 4 && n != 7).ToList(); // buyers 4 and 7 give up and stop polling
            int eligible = waiting.Count(n => n <= threshold);
            threshold += Limit - eligible;
            var letIn = waiting.Where(n => n <= threshold).Take(Limit).ToList();
            waiting = waiting.Where(n => !letIn.Contains(n)).ToList();
            admitted.AddRange(letIn);
            Console.WriteLine($"tick {tick}: threshold {threshold}, let in {string.Join(",", letIn)}, still waiting {waiting.Count}");
        }
        bool fair = Enumerable.Range(1, admitted.Count - 1).All(i => admitted[i - 1] < admitted[i]);

        // ---- 3. A slow dependency ----
        const int Timeout = 10; // time units a worker is stuck on a call that never answers
        Console.WriteLine("== Slow session store: 8 workers call it at once ==");
        const int Workers = 8, Permits = 2;
        int unguarded = Workers * Timeout;
        int guarded = Permits * Timeout; // the rest are refused at once and use the guest fallback
        Console.WriteLine($"no limit: {unguarded} worker time lost");
        Console.WriteLine($"limit of {Permits} at a time: {guarded} worker time lost, {Workers - Permits} served at once as guests");

        Console.WriteLine("== Circuit breaker: 6 calls in a row to a dead store ==");
        const int OpenAfter = 2;
        int failures = 0, lost = 0;
        for (int call = 1; call <= 6; call++)
        {
            if (failures >= OpenAfter) { Console.WriteLine($"call {call}: circuit open, refused at once"); continue; }
            failures++; lost += Timeout;
            Console.WriteLine($"call {call}: waited {Timeout}, failed");
        }
        Console.WriteLine($"time lost: {lost} instead of {6 * Timeout}");

        bool ok = served == 3 && fair && admitted.Count == 8 && guarded == 20 && lost == 20;
        Console.WriteLine($"checks {(ok ? "passed" : "FAILED")}");
        return ok ? 0 : 1;
    }
}
