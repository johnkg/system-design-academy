// A host application that calls third-party plugins while it serves requests, with and without isolation. Time moves in
// ticks of 100 ms for 300 seconds. 20 requests arrive each second, and each one is handled by the host and then by one
// of 5 plugins in turn. At 60 s an update makes plugin 3 misbehave. Everything is integers and nothing is random, so
// the output never changes. Plugin calls run either inside the host's own workers or in a sandbox per plugin.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const int Ticks = 3000, ArriveUntil = 2900, Arrive = 2;   // 2 requests a tick = 20 a second; the last 10 s is for finishing
    const int Workers = 40;          // host workers, shared by everything in the host process
    const int Host = 2;              // ticks of the host's own work on each request
    const int Plugins = 5, Bad = 3, BadAt = 600; // plugin 3 misbehaves from tick 600
    const int Normal = 3, Slow = 15, SlowEvery = 25; // a plugin call takes 300 ms, and every 25th one (a big document) takes 1,500 ms
    const int Pool = 4;              // sandbox: calls to one plugin that may run at once (its resource limit)
    const int BreakAfter = 5, BreakFor = 600; // sandbox: 5 failures in a row switch a plugin off for 60 s
    const int Restart = 300;         // in-process: a crash takes the whole host down for 30 s
    const int Snoop = 50;            // records a snooping plugin reads outside its grant on every call
    const int Patience = 100;        // a user gives up after waiting 10 s in the queue
    const int Hang = 1000000, Crash = -1;

    class Req { public int Plugin, Arrived; }
    class Work { public Req R = new(); public int End; public string Stage = ""; public bool Ok; }

    static void Run(string name, bool sandbox = false, string bad = "none", int timeout = 20)
    {
        int nextId = 0, downUntil = 0, restarts = 0, leaked = 0, denied = 0, badFailed = 0;
        int served = 0, fast = 0, healthyTotal = 0, healthyFailed = 0;
        var queue = new List<Req>(); var running = new List<Work>();
        var calls = new int[Plugins]; var used = new int[Plugins]; var streak = new int[Plugins]; var offUntil = new int[Plugins];
        var latency = new Dictionary<int, int>(); // ticks from arrival to answer -> requests

        // One request is finished: answered (maybe without its plugin) or dropped.
        void Finish(Req r, int t, bool pluginOk, bool dropped)
        {
            if (r.Plugin != Bad) { healthyTotal++; if (dropped || !pluginOk) healthyFailed++; }
            if (dropped) return;
            served++;
            int d = t - r.Arrived;
            latency[d] = latency.GetValueOrDefault(d) + 1;
            if (d <= 10) fast++;
        }
        // How long this call takes: the update at BadAt makes plugin 3 hang, crash or snoop.
        int CallTicks(int plugin, int t)
        {
            int n = calls[plugin]++;
            if (plugin == Bad && bad != "none" && t >= BadAt)
            {
                if (bad == "hang") return Hang;
                if (bad == "crash") return Crash;
                if (sandbox) denied += Snoop; else leaked += Snoop; // snoop: works normally, and reads what it should not
                return Normal;
            }
            return n % SlowEvery == SlowEvery - 1 ? Slow : Normal;
        }
        void Failed(int plugin, int t)
        {
            if (plugin == Bad) badFailed++;
            if (++streak[plugin] >= BreakAfter) offUntil[plugin] = t + BreakFor;
        }

        for (int t = 0; t < Ticks; t++)
        {
            int arrivals = t < ArriveUntil ? Arrive : 0;
            if (!sandbox && t < downUntil) // the host is restarting: nobody is served
            {
                for (int i = 0; i < arrivals; i++) Finish(new Req { Plugin = nextId++ % Plugins, Arrived = t }, t, false, true);
                continue;
            }
            var due = running.Where(x => x.End == t).ToList();
            running = running.Where(x => x.End != t).ToList();
            foreach (var x in due)
            {
                int p = x.R.Plugin;
                if (!sandbox) Finish(x.R, t, x.Ok, false);
                else if (x.Stage == "plugin") // the sandboxed call is over
                {
                    used[p]--;
                    if (x.Ok) streak[p] = 0; else Failed(p, t);
                    Finish(x.R, t, x.Ok, false);
                }
                else if (t < offUntil[p] || used[p] >= Pool) // switched off or at its limit: the host goes on without it
                {
                    if (p == Bad) badFailed++;
                    Finish(x.R, t, false, false);
                }
                else
                {
                    int d = CallTicks(p, t);
                    if (d == Crash) { Failed(p, t); Finish(x.R, t, false, false); } // only the sandbox dies, and restarts
                    else { used[p]++; running.Add(new Work { R = x.R, End = t + Math.Min(d, timeout), Stage = "plugin", Ok = d <= timeout }); }
                }
            }
            for (int i = 0; i < arrivals; i++) queue.Add(new Req { Plugin = nextId++ % Plugins, Arrived = t });
            while (queue.Count > 0 && t - queue[0].Arrived > Patience) { Finish(queue[0], t, false, true); queue.RemoveAt(0); }
            int busy = running.Count(x => x.Stage != "plugin");
            while (queue.Count > 0 && busy < Workers)
            {
                var r = queue[0]; queue.RemoveAt(0);
                busy++;
                if (sandbox) { running.Add(new Work { R = r, End = t + Host, Stage = "host" }); continue; }
                int d = CallTicks(r.Plugin, t);
                if (d == Crash) // the plugin brings the whole host process down, and everything in flight with it
                {
                    restarts++; downUntil = t + Restart;
                    Finish(r, t, false, true);
                    foreach (var x in running) Finish(x.R, t, false, true);
                    running = new List<Work>();
                    foreach (var q in queue) Finish(q, t, false, true);
                    queue = new List<Req>();
                    break;
                }
                if (r.Plugin == Bad && d > timeout) badFailed++;
                running.Add(new Work { R = r, End = t + Host + Math.Min(d, timeout), Ok = d <= timeout });
            }
        }
        foreach (var r in queue) Finish(r, Ticks, false, true);   // never reached by the end
        foreach (var x in running) Finish(x.R, Ticks, false, true);

        int total = ArriveUntil * Arrive, seen = 0, p95 = 0;
        foreach (int d in latency.Keys.OrderBy(x => x))
        {
            seen += latency[d];
            if (seen * 100 >= served * 95) { p95 = d * 100; break; }
        }
        Console.WriteLine($"-- {name}");
        Console.WriteLine($"  requests served {served * 100 / total}%, answered within 1 s {fast * 100 / total}%, p95 latency {p95} ms");
        Console.WriteLine($"  requests for the 4 healthy plugins: {healthyFailed} of {healthyTotal} dropped or without their plugin; the misbehaving plugin: {badFailed} calls failed or refused");
        Console.WriteLine($"  host restarts {restarts}; records read outside the grant {leaked}, blocked {denied}");
        if (served > total) throw new Exception("more answers than requests");
    }

    public static void Main()
    {
        Run("in the host process, all plugins healthy, 2 s timeout");
        Run("in the host process, plugin hangs, 2 s timeout", bad: "hang");
        Run("in the host process, plugin hangs, 60 s timeout", bad: "hang", timeout: 600);
        Run("in the host process, plugin crashes", bad: "crash");
        Run("in the host process, plugin snoops", bad: "snoop");
        Run("sandbox per plugin, plugin hangs, 60 s timeout", sandbox: true, bad: "hang", timeout: 600);
        Run("sandbox per plugin, plugin crashes", sandbox: true, bad: "crash");
        Run("sandbox per plugin, plugin snoops", sandbox: true, bad: "snoop");
        Run("sandbox per plugin, all healthy, 1 s timeout", sandbox: true, timeout: 10);
    }
}
