// The token budget of an LLM gateway, in C#:
// each team has a token bucket. A request reserves "prompt + max output" before it runs and gets the unused part back when it finishes.
using System;
using System.Collections.Generic;
using System.Linq;

public class Budget
{
    // Levels are kept in milli-tokens so refills are exact integers. rate is tokens per second, now is in milliseconds.
    const int Milli = 1000; // milli-tokens per token
    readonly long cap, rate;
    long level, last;
    public Budget(long capacity, long rate) { cap = capacity * Milli; this.rate = rate; level = cap; last = 0; }
    void Refill(long now) { level = Math.Min(cap, level + (now - last) * rate); last = now; }
    public bool Reserve(long tokens, long now)
    {
        Refill(now);
        if (level < tokens * Milli) return false;
        level -= tokens * Milli;
        return true;
    }
    public void Settle(long reserved, long used) { level = Math.Min(cap, level + (reserved - used) * Milli); }
}

public class Stats { public int Ok, Rejected; public long Tokens, Cost; }

public static class Program
{
    // Price per token in micro-dollars: (input, output). Short prompts go to the small model, the rest to the large one.
    static readonly long[] Small = { 1, 4 }, Large = { 3, 15 };
    static readonly (string Name, long Cap, long Rate)[] Teams = { ("search", 20000, 3000), ("support", 20000, 3000), ("research", 40000, 6000) };

    const ulong Seed = 7;
    const int Requests = 300;
    const int GapMinMs = 40; // requests arrive 40..239 ms apart
    const int GapSpreadMs = 200;
    const int PromptMin = 200; // prompt tokens: 200..1999
    const int PromptSpread = 1800;
    const int MaxOut = 1024; // output tokens reserved per request
    const int OutMin = 50; // output tokens really used: 50..549
    const int OutSpread = 500;
    const int SmallPromptLimit = 800; // shorter prompts go to the small model
    const int MsPerSecond = 1000;
    static ulong seed = Seed;
    static int Random(int n) { seed = (seed * 1664525UL + 1013904223UL) % 4294967296UL; return (int)((seed / 65536) % (ulong)n); }

    static (Stats[] Stats, double Seconds) Simulate(bool refund)
    {
        seed = Seed;
        var budgets = Teams.Select(t => new Budget(t.Cap, t.Rate)).ToArray();
        var stats = Teams.Select(_ => new Stats()).ToArray();
        long now = 0;
        for (int i = 0; i < Requests; i++)
        {
            now += GapMinMs + Random(GapSpreadMs);
            int team = Random(Teams.Length), prompt = PromptMin + Random(PromptSpread), maxOut = MaxOut, outTokens = OutMin + Random(OutSpread);
            int reserved = prompt + maxOut;
            if (!budgets[team].Reserve(reserved, now)) { stats[team].Rejected++; continue; }
            var price = prompt < SmallPromptLimit ? Small : Large;
            int used = prompt + outTokens;
            if (refund) budgets[team].Settle(reserved, used); // without it the whole reservation stays spent
            stats[team].Ok++; stats[team].Tokens += used;
            stats[team].Cost += prompt * price[0] + outTokens * price[1];
        }
        return (stats, now / (double)MsPerSecond);
    }

    public static int Main()
    {
        foreach (var refund in new[] { true, false })
        {
            var (stats, seconds) = Simulate(refund);
            Console.WriteLine(refund ? "reserve, then refund the unused part:" : "reserve and never refund:");
            for (int i = 0; i < Teams.Length; i++)
            {
                var s = stats[i];
                Console.WriteLine($"  {Teams[i].Name}: {s.Ok} served, {s.Rejected} rejected, {s.Tokens} tokens, cost {s.Cost} micro-dollars");
                double allowed = Teams[i].Cap + Teams[i].Rate * seconds; // a bucket can never hand out more than this
                if (s.Tokens > allowed) { Console.WriteLine("budget exceeded"); return 1; }
            }
        }
        int withRefund = Simulate(true).Stats.Sum(s => s.Ok), without = Simulate(false).Stats.Sum(s => s.Ok);
        Console.WriteLine($"served with refund: {withRefund}, without: {without}");
        return withRefund <= without ? 1 : 0;
    }
}
