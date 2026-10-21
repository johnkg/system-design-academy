// A lock service with leases and fencing tokens, in C#:
// a paused holder loses its lease, a new holder gets a higher token, and the storage rejects the old token.
// All times are logical milliseconds, so the run is the same every time.
using System;
using System.Collections.Generic;

public class LockService
{
    public const int Ttl = 10000; // lease length
    int counter = 0, expires = 0;
    string? holder = null;

    // Returns a fencing token, or 0 when someone else holds a live lease.
    public int Acquire(string who, int now)
    {
        if (holder != null && now < expires) return 0;
        holder = who; expires = now + Ttl;
        return ++counter;
    }
    public void Release(string who) { if (holder == who) holder = null; }
    // A failover to an asynchronous replica: the newest grant and counter value were never copied.
    public void Failover() { holder = null; counter -= 1; }
}

public class Storage
{
    readonly bool fencing;
    int maxToken = 0;
    public const int InitialValue = 100;
    public int Value = InitialValue;
    public Storage(bool fencing) { this.fencing = fencing; }

    bool Accept(int token) // the heart of fencing: remember the highest token, refuse any lower one
    {
        if (fencing && token < maxToken) return false;
        maxToken = Math.Max(maxToken, token);
        return true;
    }
    public int? Read(int token) => Accept(token) ? Value : null;
    public bool Write(int token, int v) { if (!Accept(token)) return false; Value = v; return true; }
}

public static class Program
{
    const int RetryAfter = 500; // how long A waits before it takes the lock again
    // Worker A reads, then stalls. Worker B takes the lock and does a full read-modify-write. A then writes.
    static int Run(string name, bool fencing, bool failover)
    {
        var lockSvc = new LockService(); var store = new Storage(fencing);
        int tokenA = lockSvc.Acquire("A", 0);
        int seenByA = store.Read(tokenA) ?? -1;                  // A reads 100 at 500 ms
        if (lockSvc.Acquire("B", 1000) != 0) throw new Exception("B got a lock that A holds");
        if (failover) lockSvc.Failover();                        // at 2000 ms
        int bAt = failover ? 2500 : 10500, aWrites = failover ? 4500 : 19500;
        int tokenB = lockSvc.Acquire("B", bAt);                  // after the lease expired, or after the failover
        int seenByB = store.Read(tokenB) ?? -1;
        store.Write(tokenB, seenByB + 1);                        // B writes 101
        lockSvc.Release("B");
        bool accepted = store.Write(tokenA, seenByA + 1);        // A writes the stale result
        if (!accepted)                                           // A learns it lost the lock and starts again
        {
            int t = lockSvc.Acquire("A", aWrites + RetryAfter);
            store.Write(t, (store.Read(t) ?? -1) + 1);
            lockSvc.Release("A");
        }
        Console.WriteLine($"{name}: tokens A={tokenA} B={tokenB}; stale write {(accepted ? "accepted" : "rejected")}; final value {store.Value} (expected 102)");
        return store.Value;
    }

    public static int Main()
    {
        var results = new List<int> {
            Run("no fencing           ", false, false),
            Run("fencing, consensus   ", true, false),
            Run("fencing, redis failover", true, true),
        };
        Console.WriteLine($"results: {string.Join(", ", results)}");

        // Invariants: without fencing an update is lost; with monotonic tokens nothing is lost; a token counter that goes back defeats fencing.
        return results[0] == 101 && results[1] == 102 && results[2] == 101 ? 0 : 1;
    }
}
