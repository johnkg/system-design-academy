// A hierarchical timing wheel with cancellation, in C#:
// three levels of 64 slots, so a timer is placed once in O(1), moves down a level when its turn comes, and fires on exactly its tick.
using System;
using System.Collections.Generic;
using System.Linq;

public record Timer(int Id, int Due);

public class TimingWheel
{
    const int Bits = 6, Slots = 1 << Bits, Levels = 3; // level 0 = 1 tick per slot, level 1 = 64 ticks, level 2 = 4,096 ticks
    public int Now;
    readonly List<Timer>[][] levels = Enumerable.Range(0, Levels).Select(_ => Enumerable.Range(0, Slots).Select(_ => new List<Timer>()).ToArray()).ToArray();
    public readonly HashSet<int> Cancelled = new();
    public readonly int[] Moved = new int[Levels]; // how many timers each level handed down

    // The farther away the due tick, the coarser the level that holds the timer.
    public int Add(Timer timer)
    {
        int delta = timer.Due - Now, level = 0;
        while (level < Levels - 1 && delta >= 1 << (Bits * (level + 1))) level++;
        levels[level][(timer.Due >> (Bits * level)) & (Slots - 1)].Add(timer);
        return level;
    }

    public void Cancel(int id) => Cancelled.Add(id); // lazy: the timer is skipped when its slot comes up

    // Advance one tick: cascade the coarse slots that start now, then fire the fine slot.
    public List<Timer> Tick()
    {
        Now++;
        for (int level = Levels - 1; level >= 1; level--)
        {
            if (Now % (1 << (Bits * level)) != 0) continue;
            int slot = (Now >> (Bits * level)) & (Slots - 1);
            var moving = levels[level][slot];
            levels[level][slot] = new List<Timer>();
            Moved[level] += moving.Count;
            foreach (var t in moving) Add(t);
        }
        int fine = Now & (Slots - 1);
        var due = levels[0][fine];
        levels[0][fine] = new List<Timer>();
        return due.Where(t => !Cancelled.Contains(t.Id)).OrderBy(t => t.Id).ToList();
    }
}

public static class Program
{
    const long Seed = 2024;
    const int Horizon = 200000; // ticks simulated
    const int FirstBatch = 3000, LateBatch = 200, LateAt = 1000, LateHorizon = 150000;
    const int CancelEvery = 10, CancelIdEnd = 3; // ids ending in 3 are cancelled: 10%
    static long seed = Seed;
    static int Random(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)((seed / 256) % n); }

    public static int Main()
    {
        var wheel = new TimingWheel();
        var timers = new List<Timer>();
        var placed = new int[3];
        void Schedule(int id, int due) { var t = new Timer(id, due); timers.Add(t); placed[wheel.Add(t)]++; }

        for (int id = 0; id < FirstBatch; id++) Schedule(id, 1 + Random(Horizon));
        foreach (var t in timers) if (t.Id % CancelEvery == CancelIdEnd) wheel.Cancel(t.Id); // 10% are cancelled before they are due

        var fired = new List<Timer>();
        bool onTime = true;
        while (wheel.Now < Horizon)
        {
            if (wheel.Now == LateAt) // new timers keep arriving while the wheel turns
            {
                for (int id = FirstBatch; id < FirstBatch + LateBatch; id++) Schedule(id, wheel.Now + 1 + Random(LateHorizon));
                foreach (var t in timers) if (t.Id >= FirstBatch && t.Id % CancelEvery == CancelIdEnd) wheel.Cancel(t.Id);
            }
            foreach (var t in wheel.Tick()) { fired.Add(t); if (t.Due != wheel.Now) onTime = false; }
        }

        var expected = timers.Where(t => !wheel.Cancelled.Contains(t.Id)).OrderBy(t => t.Due).ThenBy(t => t.Id).ToList();
        bool sameOrder = fired.SequenceEqual(expected);
        string flag(bool b) => b ? "true" : "false";
        Console.WriteLine($"timers {timers.Count}, cancelled {wheel.Cancelled.Count}, fired {fired.Count}");
        Console.WriteLine($"placed on arrival by level: L0 {placed[0]}, L1 {placed[1]}, L2 {placed[2]}");
        Console.WriteLine("first 5 fired: " + string.Join(", ", fired.Take(5).Select(t => $"#{t.Id}@{t.Due}")));
        Console.WriteLine($"cascaded down: {wheel.Moved[2]} from level 2, {wheel.Moved[1]} from level 1");
        Console.WriteLine($"every timer fired on its own tick: {flag(onTime)}; same order as a full sort: {flag(sameOrder)}");
        return !onTime || !sameOrder || fired.Count != timers.Count - wheel.Cancelled.Count ? 1 : 0;
    }
}
