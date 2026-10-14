// Live comments and reactions, in C#:
// edge nodes count reactions and keep only their best few comments each second, and a root merges the small summaries.
using System;
using System.Collections.Generic;
using System.Linq;

public record Comment(int Id, long Pri);

public class Edge
{
    public const int Keep = 4, Types = 4;
    public int[] Counts = new int[Types];
    public List<Comment> Best = new();
    public int Dropped;

    public void React(int type) => Counts[type]++;

    public void Comment(int id)
    {
        if (Program.Flagged(id)) { Dropped++; return; }           // moderation happens before anything is published
        Best.Add(new Comment(id, Program.Priority(id)));
        Best = Best.OrderBy(c => -c.Pri).ThenBy(c => c.Id).Take(Keep).ToList(); // memory stays at Keep comments
    }
}

public static class Program
{
    const int Edges = 8, Seconds = 5, Keep = 4, Types = 4;
    static readonly string[] Names = { "heart", "laugh", "clap", "wow" };
    static uint seed = 7;

    static int Rnd(int n) { seed = unchecked(seed * 1664525u + 1013904223u); return (int)((seed >> 16) % (uint)n); }

    // A fixed hash gives every comment the same priority on every node, so sampling needs no coordination.
    public static long Priority(int id)
    {
        uint x = unchecked((uint)(id ^ (id >> 16)) * 2246822519u);
        x = unchecked((x ^ (x >> 13)) * 3266489917u);
        return x ^ (x >> 16);
    }

    public static bool Flagged(int id) => id % 11 == 0; // stands in for the moderation verdict

    static int PickType() { int r = Rnd(10); return r < 5 ? 0 : r < 8 ? 1 : r < 9 ? 2 : 3; }

    static string Ids(IEnumerable<Comment> list) => string.Join(",", list.Select(c => c.Id));

    public static int Main()
    {
        var total = new int[Types]; var truthTotal = new int[Types];
        int nextId = 0, eventsIn = 0, messagesOut = 0, accepted = 0, shownCount = 0; bool ok = true;
        for (int s = 0; s < Seconds; s++)
        {
            var edges = Enumerable.Range(0, Edges).Select(_ => new Edge()).ToList();
            var everything = new List<Comment>(); // the slow, obvious record of every accepted comment, to check against
            foreach (var edge in edges)
            {
                int reactions = 200 + Rnd(100), comments = 20 + Rnd(10);
                for (int i = 0; i < reactions; i++) { int t = PickType(); edge.React(t); truthTotal[t]++; }
                for (int i = 0; i < comments; i++) { int id = ++nextId; edge.Comment(id); if (!Flagged(id)) everything.Add(new Comment(id, Priority(id))); }
                eventsIn += reactions + comments;
            }
            var second = new int[Types];
            foreach (var e in edges) for (int t = 0; t < Types; t++) { second[t] += e.Counts[t]; total[t] += e.Counts[t]; }
            var shown = edges.SelectMany(e => e.Best).OrderBy(c => -c.Pri).ThenBy(c => c.Id).Take(Keep).ToList(); // merging top lists is exact
            var expected = everything.OrderBy(c => -c.Pri).ThenBy(c => c.Id).Take(Keep).ToList();
            accepted += everything.Count; shownCount += shown.Count;
            bool same = Ids(shown) == Ids(expected);
            ok = ok && same;
            messagesOut += 1; // one message per second to every viewer carries the tally and the sampled comments
            Console.WriteLine($"t={s} reactions=[{string.Join(",", second)}] shown=[{Ids(shown)}] blocked={edges.Sum(e => e.Dropped)} exact={same.ToString().ToLower()}");
        }
        bool sumOk = total.SequenceEqual(truthTotal);
        Console.WriteLine("totals: " + string.Join(" ", Names.Select((n, t) => $"{n}={total[t]}")) + $" match={sumOk.ToString().ToLower()}");
        Console.WriteLine($"events in: {eventsIn}, messages out per viewer: {messagesOut}, reduction: {eventsIn / messagesOut}x");
        // Every viewer sees only the sampled comments, so the stream a phone must read is small and the same for everyone.
        int tenths = shownCount * 1000 / accepted;
        Console.WriteLine($"comments accepted: {accepted}, shown to viewers: {shownCount}, share shown: {tenths / 10}.{tenths % 10}%");
        return ok && sumOk ? 0 : 1;
    }
}
