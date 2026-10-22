// A request fans through A -> B -> C -> database on a virtual clock (milliseconds, no real waiting).
// The user waits 2000 ms. The database is sometimes slow. We compare three policies and count work
// that keeps running after its caller gave up ("orphans"). Cancellation is OFF: nothing tells a callee
// that its caller left, so only a hop that checks the deadline itself can stop.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const long User = 2000, Gap = 50, SlowPermille = 100, Attempt = 400, Backoff = 25, Pre = 10, Post = 5, MinLeft = 50, RetryMin = 100, Inf = long.MaxValue;
    const int N = 200, Retries = 2;
    const long Seed = 12345;
    const long SlowMin = 2500, SlowSpread = 6500, FastMin = 20, FastSpread = 60; // database attempt latency (ms)

    static long seed = Seed; // Park-Miller generator, integers only so every language prints the same
    static long Next() => seed = seed * 48271 % 2147483647;

    class Span { public int Hop; public long Start, End, Left = Inf; public bool Ok; }

    // timeouts[0] = A waits on B, [1] = B waits on C, [2] = C waits on the database per attempt
    static (List<Span> spans, long D, bool good) Simulate(long[] timeouts, bool deadline, long t0, long[] attempts)
    {
        long D = t0 + User;
        var spans = new List<Span>();

        Span Run(int hop, long start)
        {
            var span = new Span { Hop = hop, Start = start, End = start };
            spans.Add(span);
            // Deadline mode: every hop enforces the absolute deadline itself and fails fast when little is left.
            long cutoff = deadline ? D : Inf;
            if (deadline && D - start < MinLeft) return span;
            long t = start + Pre; bool ok = false;
            if (t > cutoff) { span.End = cutoff; return span; }
            if (hop < 2)
            {
                long giveUp = Math.Min(deadline ? D : t + timeouts[hop], cutoff);
                var child = Run(hop + 1, t);
                if (child.Ok && child.End <= giveUp) { ok = true; t = child.End; }
                else { if (child.End > giveUp) child.Left = giveUp; t = Math.Min(child.End, giveUp); }
            }
            else
            {
                for (int i = 0; i <= Retries; i++)
                {
                    long giveUp = Math.Min(t + timeouts[2], cutoff);
                    long natural = t + attempts[i]; // when the database would really finish
                    var db = new Span { Hop = 3, Start = t, End = Math.Min(natural, deadline ? giveUp : Inf) };
                    spans.Add(db);
                    if (natural <= giveUp) { db.Ok = ok = true; t = natural; break; }
                    db.Left = giveUp; t = giveUp;
                    if (i == Retries || t >= cutoff) break;
                    if (deadline && D - t - Backoff < RetryMin) break; // the retry would not fit in the budget
                    t += Backoff;
                }
            }
            if (ok) { if (t + Post > cutoff) { t = cutoff; ok = false; } else t += Post; }
            span.End = t; span.Ok = ok;
            return span;
        }

        var top = Run(0, t0);
        if (top.End > D) top.Left = D;
        return (spans, D, top.Ok && top.End <= D);
    }

    public static int Main()
    {
        var policies = new (string name, long[] timeouts, bool deadline)[]
        {
            ("fixed 5 s everywhere", new long[] { 5000, 5000, 5000 }, false),
            ("fixed, tuned 1.8/1.2/0.4", new long[] { 1800, 1200, Attempt }, false),
            ("propagated deadline", new long[] { 0, 0, Attempt }, true),
        };
        var requests = new List<(long t0, long[] attempts)>();
        for (int i = 0; i < N; i++)
        {
            var attempts = new long[Retries + 1];
            for (int k = 0; k < Retries + 1; k++) { long s = Next(), a = Next(); attempts[k] = s % 1000 < SlowPermille ? SlowMin + a % SlowSpread : FastMin + a % FastSpread; }
            requests.Add((i * Gap, attempts));
        }

        var summary = new Dictionary<string, (int good, int orphanCalls, long orphanMs, int afterDeadline)>();
        foreach (var (name, timeouts, deadline) in policies)
        {
            int good = 0, orphanCalls = 0, afterDeadline = 0; long orphanMs = 0;
            foreach (var (t0, attempts) in requests)
            {
                var (spans, D, ok) = Simulate(timeouts, deadline, t0, attempts);
                if (ok) good++;
                foreach (var s in spans)
                {
                    long o = Math.Max(0, s.End - s.Left);
                    if (o > 0) { orphanCalls++; orphanMs += o; }
                    if (s.End > D) afterDeadline++;
                }
            }
            summary[name] = (good, orphanCalls, orphanMs, afterDeadline);
            Console.WriteLine($"{name,-26} within 2 s: {good}/{N}  orphan calls: {orphanCalls}  orphan time: {orphanMs} ms  work after deadline: {afterDeadline}");
        }

        var dl = summary["propagated deadline"]; var fixedT = summary["fixed 5 s everywhere"];
        // Invariants: a hop that enforces the deadline never works past it and never leaves an orphan.
        var violations = new List<string>();
        if (dl.afterDeadline != 0 || dl.orphanCalls != 0) violations.Add("deadline mode worked past the deadline");
        if (fixedT.orphanCalls == 0) violations.Add("fixed 5 s timeouts should leave orphans");
        if (dl.good < fixedT.good) violations.Add("the deadline policy should never succeed less often");
        if (violations.Count > 0) { Console.WriteLine(string.Join("; ", violations)); return 1; }
        Console.WriteLine("deadline propagation did no work after the deadline");
        return 0;
    }
}
