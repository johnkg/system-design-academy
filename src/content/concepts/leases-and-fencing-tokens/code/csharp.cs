// A lease manager that issues increasing fencing tokens, and a storage that can reject stale tokens.
// The clock is a plain variable so the pause scenario is deterministic.
using System;
using System.Collections.Generic;

public record Lease(int Token, int ExpiresAt);

public class LeaseManager
{
    readonly int duration;
    readonly Func<int> now;
    string? holder;
    int expiresAt;
    public int LatestToken;

    public LeaseManager(int duration, Func<int> now) { this.duration = duration; this.now = now; }

    // Grant or renew. Another node's live lease blocks the request. A new owner gets a higher token.
    public Lease? Acquire(string who)
    {
        var live = holder != null && now() < expiresAt;
        if (live && holder != who) return null;
        if (!live || holder != who) LatestToken++;
        holder = who;
        expiresAt = now() + duration;
        return new Lease(LatestToken, expiresAt);
    }
}

public class Storage
{
    readonly bool checksTokens;
    readonly LeaseManager manager;
    readonly Func<int> now;
    int maxToken;
    public string Content = "(empty)";
    public List<string> Accepted = new();
    public bool Corrupted;

    public Storage(bool checksTokens, LeaseManager manager, Func<int> now) { this.checksTokens = checksTokens; this.manager = manager; this.now = now; }

    public bool Write(string who, int token, string data)
    {
        if (checksTokens && token < maxToken)
        {
            Console.WriteLine($"t={now()} storage REJECTS {data} from {who}: token {token} < {maxToken}");
            return false;
        }
        maxToken = Math.Max(maxToken, token);
        Content = data;
        Accepted.Add(data);
        // Omniscient check for the demo: was the writer still the newest owner?
        if (token != manager.LatestToken) Corrupted = true;
        Console.WriteLine($"t={now()} storage accepts {data} from {who} (token {token})");
        return true;
    }
}

public static class Program
{
    const int LeaseTtl = 10; // seconds a lease lasts
    static int time; // seconds, moved by hand

    static Storage Scenario(bool checksTokens)
    {
        time = 0;
        var manager = new LeaseManager(LeaseTtl, () => time);
        var storage = new Storage(checksTokens, manager, () => time);

        var a = manager.Acquire("A");
        Console.WriteLine($"t={time} A gets lease: token {a!.Token}, expires at t={a.ExpiresAt}");
        time = 1;
        storage.Write("A", a.Token, "A1");
        time = 3;
        Console.WriteLine($"t={time} A passes its lease check, then a GC pause freezes it until t=18");
        time = 5;
        Console.WriteLine($"t={time} B asks for the lease: {(manager.Acquire("B") == null ? "denied, A holds it" : "granted")}");
        time = LeaseTtl;
        var b = manager.Acquire("B")!;
        Console.WriteLine($"t={time} B gets lease: token {b.Token}, expires at t={b.ExpiresAt}");
        storage.Write("B", b.Token, "B1");
        time = 18;
        Console.WriteLine($"t={time} A wakes and still believes it holds the lease");
        storage.Write("A", a.Token, "A2"); // A's token is still 1
        return storage;
    }

    static string Lower(bool flag) => flag ? "true" : "false";

    public static int Main()
    {
        Console.WriteLine("--- without fencing check ---");
        var plain = Scenario(false);
        Console.WriteLine($"file: {plain.Content}, accepted: {string.Join(",", plain.Accepted)}, corrupted: {Lower(plain.Corrupted)}");
        Console.WriteLine("--- with fencing check ---");
        var fenced = Scenario(true);
        Console.WriteLine($"file: {fenced.Content}, accepted: {string.Join(",", fenced.Accepted)}, corrupted: {Lower(fenced.Corrupted)}");

        if (!plain.Corrupted || plain.Content != "A2") throw new Exception("expected a stale write to corrupt the unfenced file");
        if (fenced.Corrupted || fenced.Content != "B1") throw new Exception("fencing must protect the file");
        Console.WriteLine("invariants hold");
        return 0;
    }
}
