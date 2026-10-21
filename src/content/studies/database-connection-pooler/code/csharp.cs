// A transaction-mode connection pooler with a bounded wait queue, in C#:
// many clients share a few server connections, the excess waits in a first-in first-out queue, and a request that waits too long fails.
// Time moves in whole milliseconds.
using System;
using System.Collections.Generic;
using System.Linq;

public record Request(int Duration, int Arrived);

public static class Rng
{
    static long seed = Program.BurstSeed;
    public static void Seed(long s) { seed = s; }
    public static int Next(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)((seed / 65536) % n); }
}

public class Pooler
{
    public const int WaitLimit = 20; // a request that has waited this long is rejected
    readonly int size;
    List<int> busy = new();
    readonly List<Request> queue = new();
    public int MaxBusy, Served, TimedOut;
    public readonly List<int> Waits = new();

    public Pooler(int size) { this.size = size; }

    // One millisecond: finish queries, drop requests that waited too long, then lend free server connections to the queue in order.
    public void Tick(int now, List<int> arrivals)
    {
        busy = busy.Where(end => end > now).ToList();
        queue.AddRange(arrivals.Select(d => new Request(d, now)));
        while (queue.Count > 0 && now - queue[0].Arrived >= WaitLimit) { queue.RemoveAt(0); TimedOut++; }
        while (queue.Count > 0 && busy.Count < size)
        {
            var r = queue[0]; queue.RemoveAt(0);
            busy.Add(now + r.Duration); // the server connection is returned to the pool when the transaction ends
            Waits.Add(now - r.Arrived);
            Served++;
        }
        MaxBusy = Math.Max(MaxBusy, busy.Count);
    }
}

public static class Program
{
    internal const int BurstSeed = 7;
    const int Requests = 300; // requests in the burst
    const int BurstMs = 100; // they all arrive within this window
    const int MinTxMs = 5; // each transaction takes 5..15 ms
    const int TxSpreadMs = 11;
    const int RunMs = 400; // simulated time, long enough to drain the queue
    const int LeakSeed = 99;
    const int LeakSteps = 300;
    const int Clients = 12;
    const int ServerConns = 3; // server connections in transaction mode
    // 300 requests arrive within 100 ms (a burst) and each transaction takes 5 to 15 ms.
    static List<int>[] MakeBurst()
    {
        Rng.Seed(BurstSeed);
        var byTime = Enumerable.Range(0, BurstMs).Select(_ => new List<int>()).ToArray();
        for (int i = 0; i < Requests; i++) { int t = Rng.Next(BurstMs); byTime[t].Add(MinTxMs + Rng.Next(TxSpreadMs)); }
        return byTime;
    }

    static int Run(int size)
    {
        var burst = MakeBurst();
        var pooler = new Pooler(size);
        for (int now = 0; now < RunMs; now++) pooler.Tick(now, now < BurstMs ? burst[now] : new List<int>());
        int maxWait = pooler.Waits.Max();
        int avgWait = pooler.Waits.Sum() / pooler.Waits.Count;
        Console.WriteLine($"pool {size,2}: served {pooler.Served}, timed out {pooler.TimedOut}, max busy {pooler.MaxBusy}, max wait {maxWait}, avg wait {avgWait}");
        if (pooler.MaxBusy > size) throw new Exception("the pool was exceeded");
        if (pooler.Served + pooler.TimedOut != Requests) throw new Exception("a request was lost");
        return pooler.TimedOut;
    }

    // Session state under transaction pooling: a client sets a value on its server connection, and a later transaction may land on another one.
    static int Leaks(string mode)
    {
        Rng.Seed(LeakSeed);
        var own = new HashSet<int>();                // what each client believes it set
        var state = new Dictionary<string, int>();   // what each server connection holds, keyed by client in session mode and by connection otherwise
        int wrong = 0;
        for (int step = 0; step < LeakSteps; step++)
        {
            int client = Rng.Next(Clients);
            string conn = mode == "session" ? $"client{client}" : $"conn{Rng.Next(ServerConns)}";
            if (Rng.Next(2) == 0) { state[conn] = client; own.Add(client); }                             // SET timezone for this client
            else if (own.Contains(client) && !(state.TryGetValue(conn, out var v) && v == client)) wrong++; // SHOW timezone sees another client's value
        }
        return wrong;
    }

    public static int Main()
    {
        var failures = new[] { 8, 16, 32, 64 }.Select(Run).ToArray();
        for (int i = 1; i < failures.Length; i++) if (failures[i] > failures[i - 1]) return 1; // a bigger pool never rejects more
        int sessionWrong = Leaks("session"), transactionWrong = Leaks("transaction");
        Console.WriteLine($"wrong session state: session mode {sessionWrong}, transaction mode {transactionWrong}");
        return sessionWrong != 0 || transactionWrong == 0 ? 1 : 0;
    }
}
