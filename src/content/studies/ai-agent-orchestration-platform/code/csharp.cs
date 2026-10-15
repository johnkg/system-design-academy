// A durable agent loop, in C#:
// every step is recorded in a log, tool calls carry an idempotency key, risky tools wait for approval, and budgets stop runaway runs.
using System;
using System.Collections.Generic;
using System.Linq;

record Act(string Tool, string Arg);
record Rec(Act Act, string Result, int Cost);
class Crash : Exception { }

class World
{
    // The outside world: it counts how many times each tool really ran, and remembers the keys it has seen.
    public Dictionary<string, int> Effects = new() { ["search"] = 0, ["calc"] = 0, ["deploy"] = 0 };
    Dictionary<string, string> seen = new();
    public string Call(Act act, string? key)
    {
        if (key != null && seen.ContainsKey(key)) return seen[key]; // a repeat of the same call: return the saved result, do nothing
        Effects[act.Tool]++;
        var result = $"{act.Tool}({act.Arg}) ok";
        if (key != null) seen[key] = result;
        return result;
    }
}

class Opts
{
    public string Name = "", Policy = "good";
    public World World = new();
    public List<Rec> Log = new();
    public int MaxSteps = 10, Budget = 1000, CrashAt = -1;
    public Func<Act, bool> Approve = _ => true;
    public bool UseKeys = true;
}

static class Program
{
    static readonly Dictionary<string, (bool Risky, int Cost)> Tools = new()
    {
        ["search"] = (false, 120), ["calc"] = (false, 60), ["deploy"] = (true, 200),
    };

    // A stand-in for the model: it decides the next action from the step number. The real action is saved in the log.
    static Act Policy(string name, int i) => name switch
    {
        "good" => new[] { new Act("search", "pricing"), new Act("search", "volume"), new Act("calc", "40+2"), new Act("deploy", "v7"), new Act("finish", "") }[i],
        "stuck" => new Act("search", "pricing"),
        _ => new Act("search", $"q{i}"),
    };

    static int TokensUsed(List<Rec> log) => log.Sum(r => r.Cost);

    static string RunAgent(Opts o)
    {
        var log = o.Log;
        for (int i = 0; ; i++)
        {
            if (TokensUsed(log) >= o.Budget) return "budget";
            if (i >= o.MaxSteps) return "max-steps";
            if (i < log.Count) { if (log[i].Act.Tool == "finish") return "done"; continue; } // already done before a crash: skip it
            var act = Policy(o.Policy, i);
            if (act.Tool == "finish") { log.Add(new Rec(act, "done", 50)); return "done"; }
            int n = log.Count;
            if (n >= 2 && log[n - 1].Act == act && log[n - 2].Act == act) return "loop";
            if (Tools[act.Tool].Risky && !o.Approve(act)) return "denied";
            var result = o.World.Call(act, o.UseKeys ? $"{o.Name}:{i}" : null);
            if (o.CrashAt == i) throw new Crash(); // the tool ran, but the step was not yet written to the log
            log.Add(new Rec(act, result, Tools[act.Tool].Cost));
        }
    }

    static (string Status, List<Rec> Log, Dictionary<string, int> W) Scenario(Opts o)
    {
        string status, resumed = "no";
        try { status = RunAgent(o); }
        catch (Crash) { resumed = "yes"; o.CrashAt = -1; status = RunAgent(o); } // a new worker picks up the same log
        var w = o.World.Effects;
        Console.WriteLine($"{o.Name}: {status}, steps {o.Log.Count}, tokens {TokensUsed(o.Log)}, resumed {resumed}, ran search {w["search"]} calc {w["calc"]} deploy {w["deploy"]}");
        return (status, o.Log, w);
    }

    static int Main()
    {
        var a = Scenario(new Opts { Name = "crash-with-keys", CrashAt = 3 });
        var b = Scenario(new Opts { Name = "crash-no-keys", CrashAt = 3, UseKeys = false });
        var c = Scenario(new Opts { Name = "denied", Approve = _ => false });
        var d = Scenario(new Opts { Name = "stuck", Policy = "stuck" });
        var e = Scenario(new Opts { Name = "long", Policy = "long", Budget = 500 });

        bool ok = a.Status == "done" && a.W["deploy"] == 1 && a.Log.Count == 5 && b.W["deploy"] == 2
            && c.Status == "denied" && c.W["deploy"] == 0 && d.Status == "loop" && d.Log.Count == 2
            && e.Status == "budget" && e.Log.Count == 5;
        Console.WriteLine($"invariants hold: {(ok ? "true" : "false")}");
        return ok ? 0 : 1;
    }
}
