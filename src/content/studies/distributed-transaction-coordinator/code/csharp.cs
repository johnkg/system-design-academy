// Two-phase commit with a durable coordinator log and presumed abort, in C#:
// participants lock and promise in phase one, the coordinator logs COMMIT before telling anyone,
// and after a crash the in-doubt participants ask the coordinator, which answers "abort" when its log has no commit record.
using System;
using System.Collections.Generic;
using System.Linq;

var shards = new Dictionary<string, Shard> { ["A"] = new Shard("A", 100), ["B"] = new Shard("B", 100), ["C"] = new Shard("C", 100) };
var coordinator = new Coordinator(shards);

void Show()
{
    var held = string.Join(",", shards.Values.Where(s => s.Lock != null).Select(s => $"{s.Name}:{s.Lock}"));
    Console.WriteLine($"  {string.Join(" ", shards.Values.Select(s => $"{s.Name}={s.Balance}"))} locks=[{held}]");
}
int Total() => shards.Values.Sum(s => s.Balance);

var plan = new List<(string Tx, (string, int)[] Deltas, string? CrashAt)>
{
    ("tx1", new[] { ("A", -30), ("B", 30) }, null),
    ("tx2", new[] { ("B", -50), ("C", 50) }, "before-decision"),
    ("tx3", new[] { ("A", -10), ("B", 10) }, null), // B is still locked by the in-doubt tx2
    ("recover", Array.Empty<(string, int)>(), null),
    ("tx4", new[] { ("A", -20), ("C", 20) }, "after-decision"),
    ("recover", Array.Empty<(string, int)>(), null),
    ("tx5", new[] { ("C", -40), ("B", 40) }, "mid-commit"),
    ("recover", Array.Empty<(string, int)>(), null),
    ("tx6", new[] { ("A", -500), ("C", 500) }, null),
};
foreach (var (tx, deltas, crashAt) in plan)
{
    if (tx == "recover") { Console.WriteLine("  coordinator restarts and recovers"); coordinator.Recover(); }
    else Console.WriteLine(coordinator.Run(tx, deltas, crashAt));
    Show();
}
Console.WriteLine($"log: {string.Join(", ", coordinator.Log)}");
bool clean = shards.Values.All(s => s.Lock == null);
Console.WriteLine($"money total {Total()}, all locks released: {(clean ? "true" : "false")}");
if (Total() != 300 || !clean || coordinator.Log.Any(r => r.StartsWith("abort"))) Environment.Exit(1);

class Shard
{
    public string Name; public int Balance; public string? Lock; public int Pending;
    public Shard(string name, int balance) { Name = name; Balance = balance; }

    public string Prepare(string tx, int delta) // phase 1: take the lock and promise, or refuse
    {
        if (Lock == tx) return "yes";
        if (Lock != null) return $"no (locked by {Lock})";
        if (Balance + delta < 0) return "no (insufficient funds)";
        Lock = tx; Pending = delta; // in a real system this "prepared" record is forced to disk before replying
        return "yes";
    }
    public void Commit(string tx) { if (Lock == tx) { Balance += Pending; Lock = null; Pending = 0; } } // repeating it is harmless
    public void Abort(string tx) { if (Lock == tx) { Lock = null; Pending = 0; } }
}

class Coordinator
{
    readonly Dictionary<string, Shard> shards;
    public List<string> Log = new(); // the log survives a crash, nothing else does
    public Coordinator(Dictionary<string, Shard> shards) { this.shards = shards; }

    public string Run(string tx, (string, int)[] deltas, string? crashAt)
    {
        var prepared = new List<Shard>();
        foreach (var (name, delta) in deltas)
        {
            var shard = shards[name]; var vote = shard.Prepare(tx, delta);
            prepared.Add(shard);
            if (vote != "yes") // presumed abort: nothing is logged, a missing commit record means abort
            {
                foreach (var s in prepared) s.Abort(tx);
                return $"{tx} aborted: {name} voted {vote}";
            }
        }
        if (crashAt == "before-decision") return $"{tx} coordinator crashed before logging a decision";
        Log.Add($"commit {tx}"); // the decision point: forced to disk before any shard hears of it
        if (crashAt == "after-decision") return $"{tx} coordinator crashed after logging commit";
        for (int i = 0; i < prepared.Count; i++)
        {
            prepared[i].Commit(tx);
            if (crashAt == "mid-commit" && i == 0) return $"{tx} coordinator crashed after telling {prepared[i].Name}";
        }
        Log.Add($"end {tx}");
        return $"{tx} committed";
    }

    string Outcome(string tx) => Log.Contains($"commit {tx}") ? "commit" : "abort"; // presumed abort

    public void Recover()
    {
        var finished = new List<string>();
        foreach (var shard in shards.Values)
        {
            if (shard.Lock == null) continue;
            var tx = shard.Lock; var answer = Outcome(tx);
            if (answer == "commit") { shard.Commit(tx); if (!finished.Contains(tx)) finished.Add(tx); } else shard.Abort(tx);
            Console.WriteLine($"  {shard.Name} was in doubt about {tx}, coordinator says {answer}");
        }
        foreach (var tx in finished) if (!Log.Contains($"end {tx}")) Log.Add($"end {tx}");
    }
}
