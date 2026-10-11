// A cross-shard wallet transfer in C#:
// every shard applies each operation once (keyed by transfer id), and a durable transfer record lets a crashed transfer be finished, never repeated or lost.
using System;
using System.Collections.Generic;
using System.Linq;

public record Transfer(int Id, int From, int To, int Amt, bool Crash, bool Again);

public class Record(Transfer t)
{
    public Transfer T = t;
    public string State = "INIT";
}

public class Shard
{
    public readonly Dictionary<int, int> Balance = new();
    readonly Dictionary<string, bool> applied = new();

    // Add delta to an account exactly once per operation id. Repeating the id returns the first answer. A balance never goes below zero.
    public bool Apply(string op, int account, int delta)
    {
        if (applied.TryGetValue(op, out var first)) return first;
        bool ok = Balance[account] + delta >= 0;
        if (ok) Balance[account] += delta;
        applied[op] = ok;
        return ok;
    }
}

public class Wallet
{
    public const int Shards = 4, Accounts = 8, Start = 100;
    public static int ShardOf(int account) => account % Shards;

    public static Shard[] MakeShards()
    {
        var shards = Enumerable.Range(0, Shards).Select(_ => new Shard()).ToArray();
        for (int s = 0; s < Shards; s++)
            for (int a = s; a < Accounts; a += Shards) shards[s].Balance[a] = Start;
        return shards;
    }
    public static int Total(Shard[] shards) => shards.Sum(s => s.Balance.Values.Sum());

    // The naive way: debit on one shard, then credit on another, with nothing recorded in between.
    public static (int Sum, int Twice) Naive(List<Transfer> transfers)
    {
        var shards = MakeShards(); var times = new Dictionary<int, int>();
        foreach (var t in transfers)
            for (int run = 0; run < (t.Again ? 2 : 1); run++)             // a client that timed out sends it again
            {
                if (!shards[ShardOf(t.From)].Apply($"{t.Id}:{run}:d", t.From, -t.Amt)) break;
                times[t.Id] = times.GetValueOrDefault(t.Id) + 1;
                if (t.Crash && run == 0) break;                            // the process dies before the credit
                shards[ShardOf(t.To)].Apply($"{t.Id}:{run}:c", t.To, t.Amt);
            }
        return (Total(shards), times.Values.Count(n => n > 1));
    }

    public Shard[] Shard = MakeShards();
    public readonly Dictionary<int, Record> Log = new();

    public void DoTransfer(Transfer t)
    {
        if (!Log.TryGetValue(t.Id, out var rec)) { rec = new Record(t); Log[t.Id] = rec; }   // the intent is saved first
        if (rec.State == "INIT")
            rec.State = Shard[ShardOf(rec.T.From)].Apply($"{t.Id}:d", rec.T.From, -rec.T.Amt) ? "DEBITED" : "REJECTED";
        if (rec.State == "DEBITED" && t.Crash) return;                                          // crash: the money is "in flight", recorded in the log
        if (rec.State == "DEBITED") { Shard[ShardOf(rec.T.To)].Apply($"{t.Id}:c", rec.T.To, rec.T.Amt); rec.State = "DONE"; }
    }
    public int InFlight() => Log.Values.Where(r => r.State == "DEBITED").Sum(r => r.T.Amt);
    public void Recover() { foreach (var r in Log.Values.ToList()) DoTransfer(r.T with { Crash = false }); }
    public int Count(string state) => Log.Values.Count(r => r.State == state);
}

public static class Program
{
    static long seed = 7;
    static int Random(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)(seed / 65536 % n); }

    public static int Main()
    {
        int all = Wallet.Accounts * Wallet.Start;
        var transfers = new List<Transfer>();
        for (int id = 0; id < 24; id++)
        {
            int from = Random(Wallet.Accounts);
            int to = (from + 1 + Random(Wallet.Accounts - 1)) % Wallet.Accounts;
            transfers.Add(new Transfer(id, from, to, 20 + Random(80), id % 5 == 2, id % 4 == 1));
        }

        var bad = Wallet.Naive(transfers);
        Console.WriteLine($"naive debit then credit: total {all} -> {bad.Sum}, {all - bad.Sum} lost, {bad.Twice} transfers charged twice");

        var wallet = new Wallet();
        foreach (var t in transfers) { wallet.DoTransfer(t); if (t.Again) wallet.DoTransfer(t); }   // repeats are ignored
        int stuck = wallet.Count("DEBITED");
        Console.WriteLine($"ledger after crashes: balances {Wallet.Total(wallet.Shard)} + in flight {wallet.InFlight()} = {Wallet.Total(wallet.Shard) + wallet.InFlight()}, {stuck} transfers waiting");
        wallet.Recover();
        Console.WriteLine($"ledger after recovery: balances {Wallet.Total(wallet.Shard)}, in flight {wallet.InFlight()}, done {wallet.Count("DONE")}, rejected {wallet.Count("REJECTED")}");

        bool negative = wallet.Shard.Any(s => s.Balance.Values.Any(b => b < 0));
        return Wallet.Total(wallet.Shard) != all || wallet.InFlight() != 0 || negative || stuck == 0 || bad.Sum >= all ? 1 : 0;
    }
}
