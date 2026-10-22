// A bounded log buffer with three drop policies, in C#:
// a burst of log lines meets a queue of fixed size, and the policy decides which lines are lost when it is full.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    static readonly string[] Levels = { "debug", "info", "warn", "error" }; // index = priority
    const int Capacity = 300, Drain = 60, Ticks = 60;                       // lines the buffer holds, lines shipped per tick, length of the run

    const int Debug = 0, Info = 1, Warn = 2, Error = 3;
    const int ErrorPct = 3, WarnPct = 7, InfoPct = 30; // the remaining 60% is debug
    const int NormalRate = 30, BurstRate = 150, BurstStart = 20, BurstEnd = 30; // lines per tick
    const long Seed = 7;
    static long seed = Seed;
    static int Random(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)(seed / 65536 % n); }
    static int LevelOf(int r) => r < ErrorPct ? Error : r < ErrorPct + WarnPct ? Warn : r < ErrorPct + WarnPct + InfoPct ? Info : Debug;

    static (int arrived, int[] lost, int[] sent) Run(string policy)
    {
        seed = Seed;
        var queue = new List<int>();
        var lost = new int[Levels.Length]; var sent = new int[Levels.Length];
        int arrived = 0, peak = 0;

        void Offer(int level)
        {
            if (queue.Count < Capacity) { queue.Add(level); return; }
            if (policy == "drop-newest") { lost[level]++; return; }
            if (policy == "drop-oldest") { lost[queue[0]]++; queue.RemoveAt(0); queue.Add(level); return; }
            int lowest = queue.Min();       // keep-errors: make room by evicting the oldest line of the lowest level
            if (lowest < level) { queue.RemoveAt(queue.IndexOf(lowest)); lost[lowest]++; queue.Add(level); }
            else lost[level]++;
        }

        for (int t = 0; t < Ticks; t++)
        {
            int n = t >= BurstStart && t < BurstEnd ? BurstRate : NormalRate;// a burst between ticks 20 and 29
            for (int i = 0; i < n; i++) { Offer(LevelOf(Random(100))); arrived++; }
            peak = Math.Max(peak, queue.Count);
            for (int i = 0; i < Drain && queue.Count > 0; i++) { sent[queue[0]]++; queue.RemoveAt(0); }
        }
        while (queue.Count > 0) { sent[queue[0]]++; queue.RemoveAt(0); } // the agent catches up after the burst

        string detail = string.Join(", ", new[] { 3, 2, 1, 0 }.Select(i => $"{Levels[i]} {lost[i]}"));
        Console.WriteLine($"{policy}: shipped {sent.Sum()} of {arrived}, lost {lost.Sum()} ({detail}), worst wait {(peak + Drain - 1) / Drain} ticks");
        return (arrived, lost, sent);
    }

    public static int Main()
    {
        var policies = new[] { "drop-newest", "drop-oldest", "keep-errors" };
        var errorsLost = new Dictionary<string, int>();
        foreach (var policy in policies)
        {
            var (arrived, lost, sent) = Run(policy);
            errorsLost[policy] = lost[Error];
            if (lost.Sum() + sent.Sum() != arrived) return 1; // every line is either shipped or counted as lost
        }
        bool ok = errorsLost["keep-errors"] == 0 && errorsLost["drop-newest"] > 0 && errorsLost["drop-oldest"] > 0;
        Console.WriteLine($"errors lost: {string.Join(" / ", policies.Select(p => errorsLost[p]))}; keep-errors loses none: {ok.ToString().ToLowerInvariant()}");
        return ok ? 0 : 1;
    }
}
