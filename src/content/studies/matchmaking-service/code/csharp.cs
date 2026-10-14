// A skill-based matchmaking queue in C#:
// every waiting player has a search window around their rating that widens each second, and two players match
// when their rating gap fits inside both windows. We compare a fixed window with a widening one.
using System;
using System.Collections.Generic;
using System.Linq;

public record Policy(string Name, int Base, int Step, int Cap);
public record Ticket(int Id, int Rating, int Since);
public record Result(int Matched, long GapSum, long WaitSum, int MaxWait, int Left);

public static class Matchmaker
{
    static long seed = 7;
    static int Random(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)((seed / 65536) % n); }

    // Ratings come from the sum of three dice, so most players are near the middle and a few are far out.
    public static int[] MakeRatings(int count)
    {
        var r = new int[count];
        for (int i = 0; i < count; i++) { int a = Random(600), b = Random(600), c = Random(600); r[i] = 400 + a + b + c; }
        return r;
    }

    // The window is the base plus a step for each second waited, up to a cap. A step of 0 gives a fixed window.
    static int WindowOf(Policy p, int waited) => Math.Min(p.Cap, p.Base + p.Step * waited);

    public static Result Simulate(Policy p, int[] ratings, int arrivalSeconds, int drainSeconds)
    {
        var queue = new List<Ticket>(); // waiting tickets, oldest first
        int matched = 0, maxWait = 0; long gapSum = 0, waitSum = 0;
        for (int now = 0; now < arrivalSeconds + drainSeconds; now++)
        {
            if (now < arrivalSeconds) queue.Add(new Ticket(now, ratings[now], now)); // one player joins each second
            var taken = new HashSet<int>();
            foreach (var a in queue) // oldest first, so nobody waits behind a newcomer
            {
                if (taken.Contains(a.Id)) continue;
                int wa = WindowOf(p, now - a.Since);
                Ticket? best = null; int bestGap = 0;
                foreach (var b in queue)
                {
                    if (b.Id == a.Id || taken.Contains(b.Id)) continue;
                    int gap = Math.Abs(a.Rating - b.Rating);
                    bool fits = gap <= wa && gap <= WindowOf(p, now - b.Since); // both players must accept the gap
                    if (fits && (best == null || gap < bestGap)) { best = b; bestGap = gap; }
                }
                if (best == null) continue;
                taken.Add(a.Id); taken.Add(best.Id);
                int w1 = now - a.Since, w2 = now - best.Since;
                matched++; gapSum += bestGap; waitSum += w1 + w2;
                maxWait = Math.Max(maxWait, Math.Max(w1, w2));
                if (bestGap > Math.Min(WindowOf(p, w1), WindowOf(p, w2))) throw new Exception("gap outside a window");
            }
            queue = queue.Where(t => !taken.Contains(t.Id)).ToList();
        }
        return new Result(matched, gapSum, waitSum, maxWait, queue.Count);
    }

    public static int Main()
    {
        var ratings = MakeRatings(600);
        var policies = new[] { new Policy("fixed", 25, 0, 25), new Policy("widening", 25, 10, 400) };
        var results = policies.Select(p => Simulate(p, ratings, 600, 120)).ToArray();
        for (int i = 0; i < 2; i++)
        {
            var r = results[i];
            Console.WriteLine($"{policies[i].Name}: {r.Matched} matches, {r.Left} players left, average gap {r.GapSum / r.Matched}, average wait {r.WaitSum / (2 * r.Matched)}s, longest wait {r.MaxWait}s");
        }
        Console.WriteLine($"widening window by wait: {string.Join(" ", new[] { 0, 5, 20, 40 }.Select(w => $"{w}s:{WindowOf(policies[1], w)}"))}");
        var fixedR = results[0]; var widening = results[1];
        Console.WriteLine($"widening finds {widening.Matched - fixedR.Matched} more matches and leaves {fixedR.Left - widening.Left} fewer players waiting");
        if (2 * widening.Matched + widening.Left != 600 || 2 * fixedR.Matched + fixedR.Left != 600) return 1;
        if (widening.Matched <= fixedR.Matched || fixedR.MaxWait < widening.MaxWait) return 1;
        return 0;
    }
}
