// A tiny durable workflow engine in C#:
// the workflow is plain code, its history is an append-only list of results, and after a crash a new worker replays the code against the history.
using System;
using System.Collections.Generic;
using System.Linq;

string[] steps = { "reserve", "charge", "pack", "ship", "notify" };
const int MaxAttempts = 3;
long seed = 7;
int Random(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)((seed / 65536) % n); }

// The workflow must be deterministic: same history in, same decisions out. It may only touch the world through ctx.
List<string> OrderWorkflow(Ctx ctx)
{
    var results = new List<string>();
    foreach (var step in steps) results.Add(ctx.Call(step)); // returns the recorded result, or pauses the code if there is none yet
    return results;
}

List<string> Replay(List<string> history) => OrderWorkflow(new Ctx(history));

// Runs one order to the end. The activity is at-least-once: it can run, lose its reply, and be run again.
int RunOrder(int orderId, bool idempotent, Dictionary<string, int> effects, int[] stats) // stats: completed, stuck, crashes
{
    var history = new List<string>();
    while (true)
    {
        try { Replay(history); } // a fresh worker starts here with nothing but the history
        catch (NeedActivity e)
        {
            bool done = false;
            for (int attempt = 1; attempt <= MaxAttempts && !done; attempt++)
            {
                int r = Random(100);
                if (r < 10) continue;                                  // failed before doing anything
                var key = $"{orderId}:{e.Activity}";                   // the idempotency key
                if (!(idempotent && effects.ContainsKey(key))) effects[key] = effects.GetValueOrDefault(key) + 1; // the side effect (a charge, a shipment)
                if (r < 20) continue;                                  // the effect happened but the reply was lost
                done = true;
            }
            if (!done) { stats[1]++; return history.Count; }           // retries are used up: the workflow waits for a human
            if (Random(100) < 4) { stats[2]++; continue; }             // the worker died before it wrote the result: the activity will run again
            history.Add($"{e.Activity}-{orderId}");
            continue;
        }
        stats[0]++;
        return history.Count;
    }
}

(int[] stats, int twice, int doubleCharges, int events) RunAll(bool idempotent)
{
    seed = 7;
    var effects = new Dictionary<string, int>();
    var stats = new int[3];
    int longest = 0;
    for (int id = 1; id <= 200; id++) longest = Math.Max(longest, RunOrder(id, idempotent, effects, stats));
    int twice = effects.Values.Sum(n => n - 1);
    int doubleCharges = effects.Where(kv => kv.Key.EndsWith(":charge")).Sum(kv => kv.Value - 1);
    return (stats, twice, doubleCharges, 2 + 2 * longest); // started + one scheduled and one completed event per step + finished
}

foreach (var idempotent in new[] { false, true })
{
    var r = RunAll(idempotent);
    Console.WriteLine($"idempotent={(idempotent ? "true" : "false")}: completed {r.stats[0]}, stuck {r.stats[1]}, crashes {r.stats[2]}, steps run twice {r.twice}, double charges {r.doubleCharges}, longest history {r.events} events");
    if (r.stats[0] + r.stats[1] != 200) Environment.Exit(1);
    if (idempotent && r.twice != 0) Environment.Exit(1);
    if (!idempotent && r.doubleCharges == 0) Environment.Exit(1);
}
var again = Replay(steps.Select(s => $"{s}-9").ToList());
Console.WriteLine($"replay of a full history gives: {string.Join(", ", again)}");
if (string.Join(",", again) != "reserve-9,charge-9,pack-9,ship-9,notify-9") Environment.Exit(1);

class NeedActivity : Exception { public string Activity; public NeedActivity(string name) : base(name) { Activity = name; } }

class Ctx
{
    readonly List<string> history; int pos = 0;
    public Ctx(List<string> history) { this.history = history; }
    public string Call(string name) { if (pos < history.Count) return history[pos++]; throw new NeedActivity(name); }
}
