// A miniature of the ideas in Cloudflare's Unimog, in C# (a teaching model, not Cloudflare's code or data):
// every connection's 4-tuple is hashed into a bucket of a forwarding table, each bucket holds a current and a previous
// server, a redirector sends a packet on to the previous server when the current one has no socket for it, a drain keeps
// old connections alive, and a control loop moves buckets from busy servers to idle ones.
// Everything is deterministic and uses whole numbers only, so every run prints the same thing.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

public static class Program
{
    static readonly string[] Names = { "A", "B", "C" };
    const int Buckets = 64; // always a power of two, so the low 6 bits of the hash pick the bucket (Unimog uses far more than this)
    const int Mask = Buckets - 1;
    const int None = -1;
    static readonly int[] Capacity = { 100, 200, 200 }; // how much work each server can do: a different hardware generation each (made-up units)
    static readonly int[] Background = { 0, 150, 0 }; // per mille of load from work that has nothing to do with connections (made up)
    const int Connections = 30;
    const int Spread = 20; // the control loop stops when the two loads are this close, per mille
    const int MaxRounds = 12;

    // 32-bit FNV-1a over the text of a connection's 4-tuple, standing in for Unimog's hash function.
    static uint Fnv(string text)
    {
        uint h = 0x811C9DC5;
        foreach (var b in Encoding.UTF8.GetBytes(text)) h = unchecked((h ^ b) * 0x01000193);
        return h;
    }

    static int BucketOf(int conn) => (int)(Fnv($"10.0.0.{conn}:5000>203.0.113.7:443") & Mask);

    // each bucket: [first slot, second slot]
    static int[][] NewTable() => Enumerable.Range(0, Buckets).Select(i => new[] { i % Names.Length, None }).ToArray();

    // What the redirector does with a packet. A SYN starts a connection and always stays on the first server.
    // Any other packet stays there only if that server has a socket for it, and otherwise goes on to the second server.
    static (int Server, string How) Deliver(int[][] table, HashSet<int>[] sockets, int conn, bool syn)
    {
        var b = table[BucketOf(conn)];
        int first = b[0], second = b[1];
        if (syn) return (first, "new connection on first server");
        if (sockets[first].Contains(conn)) return (first, "first hop");
        if (second != None && sockets[second].Contains(conn)) return (second, "second hop");
        return (None, "reset (connection broken)");
    }

    static (int Broken, int Hops) Tally(int[][] table, HashSet<int>[] sockets, IEnumerable<int> conns)
    {
        int broken = 0, hops = 0;
        foreach (var c in conns)
        {
            var (server, how) = Deliver(table, sockets, c, false);
            if (server == None) broken++;
            if (how == "second hop") hops++;
        }
        return (broken, hops);
    }

    static int[] BucketsPerServer(int[][] table) => Enumerable.Range(0, Names.Length).Select(s => table.Count(b => b[0] == s)).ToArray();

    // per mille of capacity in use
    static int[] Loads(int[][] table)
    {
        var n = BucketsPerServer(table);
        return Enumerable.Range(0, Names.Length).Select(s => n[s] * 1000 / Capacity[s] + Background[s]).ToArray();
    }

    // Pick the candidate with the smallest score; the lowest server number wins a tie.
    static int Lowest(IEnumerable<int> candidates, Func<int, int> score)
    {
        int best = candidates.First();
        foreach (var c in candidates)
            if (score(c) < score(best) || (score(c) == score(best) && c < best)) best = c;
        return best;
    }

    // Drain: stop new connections to a server but keep serving the old ones. With keepOld false the table has only one
    // slot per bucket, so the old server is forgotten.
    static int Drain(int[][] table, int victim, int[] others, bool keepOld, int stamp, int[] touched)
    {
        int n = 0;
        for (int i = 0; i < table.Length; i++)
        {
            var b = table[i];
            if (b[0] != victim) continue;
            var counts = BucketsPerServer(table);
            b[0] = Lowest(others, s => counts[s]);
            b[1] = keepOld ? victim : None;
            touched[i] = stamp;
            n++;
        }
        return n;
    }

    // One round of the control loop: servers above the average load give away buckets in proportion to how far above they are,
    // and the least loaded server takes them. The least recently changed buckets move first. The new owner becomes the first slot
    // and the old owner the second slot, so connections already open on the old owner keep working.
    static int Rebalance(int[][] table, int[] active, int stamp, int[] touched)
    {
        var ld = Loads(table);
        int avg = active.Sum(s => ld[s]) / active.Length;
        int moved = 0;
        foreach (var s in active)
        {
            if (ld[s] <= avg) continue;
            var mine = Enumerable.Range(0, table.Length).Where(i => table[i][0] == s).ToList();
            int give = Math.Max(1, mine.Count * (ld[s] - avg) / ld[s]);
            var order = mine.OrderBy(i => touched[i]).ThenBy(i => i).Take(give).ToList();
            foreach (var i in order)
            {
                int to = Lowest(active.Where(t => t != s), t => Loads(table)[t]);
                table[i] = new[] { to, s };
                touched[i] = stamp;
                moved++;
            }
        }
        return moved;
    }

    static void Show(string title, int[][] table)
    {
        var ld = Loads(table);
        var counts = BucketsPerServer(table);
        Console.WriteLine($"{title}: buckets " + string.Join(" ", counts.Select((n, s) => $"{Names[s]}={n}"))
            + " | load per mille " + string.Join(" ", Names.Select((n, s) => $"{n}={ld[s]}")));
    }

    public static int Main()
    {
        var conns = Enumerable.Range(0, Connections).ToList();
        var table = NewTable();
        var touched = new int[Buckets];
        var sockets = Names.Select(_ => new HashSet<int>()).ToArray();
        foreach (var c in conns) sockets[table[BucketOf(c)][0]].Add(c); // each connection is opened on the first server of its bucket
        Console.WriteLine($"{Connections} connections open: " + string.Join(" ", Names.Select((n, s) => $"{n}={sockets[s].Count}")));
        Show("start", table);

        // 1. Drain server A, first with a one-slot table, then with two slots.
        var oneSlot = table.Select(b => (int[])b.Clone()).ToArray();
        Drain(oneSlot, 0, new[] { 1, 2 }, false, 1, new int[Buckets]);
        int lostOneSlot = Tally(oneSlot, sockets, conns).Broken;
        Console.WriteLine($"drain A, one slot per bucket: {lostOneSlot} of {sockets[0].Count} connections on A broken");
        int n = Drain(table, 0, new[] { 1, 2 }, true, 1, touched);
        var (broken, hops) = Tally(table, sockets, conns);
        int lostTwoSlots = broken;
        Console.WriteLine($"drain A, two slots per bucket: {n} buckets changed, {broken} broken, {hops} connections now use a second hop");
        var fresh = Enumerable.Range(0, 12).Select(k => Deliver(table, sockets, 100 + k, true).Server);
        Console.WriteLine("12 new connections go to: " + string.Join(" ", fresh.Select(s => Names[s])));

        // 2. The connections on A end. A is no longer needed as a second server.
        sockets[0].Clear();
        foreach (var b in table) if (b[1] == 0) b[1] = None;
        var live = conns.Where(c => sockets.Any(s => s.Contains(c))).ToList();
        Console.WriteLine($"A's connections ended, {live.Count} remain, second slots cleared");

        // 3. The control loop works on the servers still in service, until the two loads are within 20 per mille of each other.
        Show("before the loop", table);
        int rnd = 0, lostInLoop = 0;
        while (true)
        {
            var ld = Loads(table);
            if (Math.Abs(ld[1] - ld[2]) <= Spread || rnd == MaxRounds) break;
            rnd++;
            int moved = Rebalance(table, new[] { 1, 2 }, rnd + 1, touched);
            (broken, hops) = Tally(table, sockets, live);
            ld = Loads(table);
            lostInLoop += broken;
            Console.WriteLine($"round {rnd}: moved {moved} buckets, load B={ld[1]} C={ld[2]}, {broken} broken, {hops} on a second hop");
        }
        Show("after the loop", table);

        // 4. The limit: change the same bucket twice in a row and the server from before the first change is forgotten.
        // A comes back from maintenance and takes a bucket whose old connections are still open on B.
        int target = Enumerable.Range(0, Buckets).First(i => table[i][1] != None && live.Any(c => BucketOf(c) == i && sockets[table[i][1]].Contains(c)));
        int first = table[target][0], second = table[target][1];
        var inBucket = live.Where(c => BucketOf(c) == target).ToList();
        table[target] = new[] { 0, first };
        (broken, hops) = Tally(table, sockets, inBucket);
        Console.WriteLine($"bucket {target} changed again before {Names[second]}'s connections ended: {broken} of {inBucket.Count} broken");
        bool ok = lostOneSlot > 0 && lostTwoSlots == 0 && lostInLoop == 0 && broken > 0;
        Console.WriteLine($"checks {(ok ? "passed" : "FAILED")}");
        return ok ? 0 : 1;
    }
}
