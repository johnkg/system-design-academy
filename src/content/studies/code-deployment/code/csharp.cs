// A staged rollout with a canary, health gates, automatic rollback and a deploy lock, in C#.
// Error rates are counted per thousand requests so that all the arithmetic is in whole numbers.
using System;
using System.Linq;

public record Result(string Status, int Hosts, int Errors);

public static class Program
{
    const int Hosts = 1000, Canary = 10, Batch = 100, Reqs = 200, Base = 2, Limit = 10;

    static uint seed = 7;
    static uint Next() { unchecked { seed = seed * 1664525u + 1013904223u; } return seed; }
    static bool Fails(int rate) => (Next() >> 8) % 1000 < rate; // one request fails with the given chance per thousand

    static readonly int[] fleet = Enumerable.Repeat(1, Hosts).ToArray(); // the version each host runs
    static int lockedBy = -1;                                            // the version whose deploy holds the lock, or -1
    static int Running(int v) => fleet.Count(x => x == v);

    // Roll a version out in waves: a small canary first, then batches. Each wave is judged by its own error rate
    // before the next one starts, and a failed gate puts the previous version back on every host that changed.
    static Result Deploy(int version, int bug, int limit, Action? during = null)
    {
        if (lockedBy >= 0) return new Result($"refused, v{lockedBy} is deploying", 0, 0);
        lockedBy = version;
        try
        {
            int previous = fleet[0], done = 0, errors = 0;
            for (int size = Canary; done < Hosts; size = Batch)
            {
                size = Math.Min(size, Hosts - done);
                for (int i = done; i < done + size; i++) fleet[i] = version;
                done += size;
                int wave = 0;
                for (int r = 0; r < size * Reqs; r++) if (Fails(Base + bug)) wave++; // traffic served by the new hosts
                errors += wave;
                if (during != null && done == Canary) during();
                if (wave * 1000 > size * Reqs * limit) // the gate: error rate above the limit
                {
                    for (int i = 0; i < Hosts; i++) if (fleet[i] == version) fleet[i] = previous;
                    return new Result($"rolled back after {done} hosts", done, errors);
                }
            }
            return new Result("complete", done, errors);
        }
        finally { lockedBy = -1; }
    }

    public static int Main()
    {
        // 1. A release with a bug that fails 3% of requests, with the gate on. A second deploy tries to start during it.
        Result? second = null;
        var gated = Deploy(2, 30, Limit, () => { second = Deploy(9, 0, Limit); });
        Console.WriteLine($"v2 with the gate: {gated.Status}, {gated.Errors} errors; v1 on {Running(1)} hosts");
        Console.WriteLine($"second deploy meanwhile: {second!.Status}");

        // 2. The same release with the gate switched off reaches every host.
        var ungated = Deploy(2, 30, 1000);
        Console.WriteLine($"v2 without a gate: {ungated.Status} on {Running(2)} hosts, {ungated.Errors} errors");
        Array.Fill(fleet, 1);

        // 3. A good release passes every gate even though 0.2% of requests fail anyway.
        var good = Deploy(3, 0, Limit);
        Console.WriteLine($"v3 without the bug: {good.Status} on {Running(3)} hosts, {good.Errors} errors");

        bool ok = gated.Hosts == Canary && gated.Errors * 20 < ungated.Errors && second!.Hosts == 0 && lockedBy < 0
            && good.Status == "complete" && Running(3) == Hosts;
        Console.WriteLine($"rollback worked, lock respected, no false alarm: {ok.ToString().ToLowerInvariant()}");
        return ok ? 0 : 1;
    }
}
