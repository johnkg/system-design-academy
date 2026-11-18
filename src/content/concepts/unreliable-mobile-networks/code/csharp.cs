// Loading one screen that needs 12 small requests over a flaky mobile link, with three client strategies, and then a fleet
// of phones reconnecting at once after an outage. Milliseconds and integers only; the seeds are fixed.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const int Reqs = 12;             // requests the screen needs
    const int Essential = 4;         // the first 4 make the screen usable; the other 8 only fill it in
    const int MaxAttempts = 4;       // attempts per request (or per batch) before giving up
    const int TransferMs = 20;       // time to move one request's data once the round trip is done
    const int RenderGapMs = 1500;    // the sequential client renders each part before it asks for the next
    const int TailMs = 1000;         // the radio stays awake this long after a transfer; a request after that wakes it again
    const int FixedTimeoutMs = 1000;
    const int BaseBackoffMs = 500, MaxBackoffMs = 8000;
    const int RetryBudget = 12;      // retries the parallel client may spend in total across all its requests

    static Func<long> MakeRng(long seed)
    {
        long s = seed;
        return () => { s = (s * 48271) % 2147483647; return s; };
    }

    // The link: for every request and attempt, a loss roll (0 to 99) and a jitter roll (0 to 99). Same for every strategy.
    static (int Roll, int Jit)[][] LinkRolls()
    {
        var next = MakeRng(150);
        var rows = new (int, int)[Reqs][];
        for (int i = 0; i < Reqs; i++)
        {
            rows[i] = new (int, int)[MaxAttempts];
            for (int j = 0; j < MaxAttempts; j++)
            {
                int roll = (int)(next() % 100);
                int jit = (int)(next() % 100);
                rows[i][j] = (roll, jit);
            }
        }
        return rows;
    }

    // Exponential backoff with "equal jitter": half the delay is fixed, the other half is random.
    static int Backoff(int attempt, int jit)
    {
        int cap = Math.Min(MaxBackoffMs, BaseBackoffMs * (1 << attempt));
        return cap / 2 + (cap / 2) * jit / 100;
    }

    // Radio wake-ups: a transfer that starts more than TailMs after the radio last went quiet wakes it again.
    static int WakeUps(List<(int Start, int End)> intervals)
    {
        int wakes = 0;
        int? last = null;
        foreach (var (start, end) in intervals.OrderBy(iv => iv.Start))
        {
            if (last == null || start - last.Value > TailMs) wakes++;
            last = last == null ? end : Math.Max(last.Value, end);
        }
        return wakes;
    }

    static (int Usable, int Attempts, int Failed, int Wakes) LoadScreen(string strategy, int lossPct, int rtt)
    {
        var rolls = LinkRolls();
        var intervals = new List<(int, int)>();
        int attempts = 0, failed = 0, usable = 0;
        bool essentialFailed = false;
        if (strategy == "sequential")
        {
            int t = 0;
            for (int i = 0; i < Reqs; i++)
            {
                bool ok = false;
                for (int j = 0; j < MaxAttempts && !ok; j++)
                {
                    attempts++;
                    int dur = rtt + TransferMs;
                    if (rolls[i][j].Roll >= lossPct && dur <= FixedTimeoutMs) { intervals.Add((t, t + dur)); t += dur; ok = true; }
                    else { intervals.Add((t, t + FixedTimeoutMs)); t += FixedTimeoutMs; } // wait out the fixed timeout, retry at once
                }
                if (!ok) { failed++; if (i < Essential) essentialFailed = true; }
                if (i == Essential - 1) usable = t;
                t += RenderGapMs;
            }
        }
        else if (strategy == "parallel")
        {
            int budget = RetryBudget;
            for (int i = 0; i < Reqs; i++)
            {
                int t = 0;
                bool ok = false;
                int timeout = 4 * rtt; // follows the network instead of a fixed number
                for (int j = 0; j < MaxAttempts; j++)
                {
                    attempts++;
                    int dur = rtt + TransferMs;
                    if (rolls[i][j].Roll >= lossPct && dur <= timeout) { intervals.Add((t, t + dur)); t += dur; ok = true; break; }
                    intervals.Add((t, t + timeout)); t += timeout;
                    if (j == MaxAttempts - 1 || budget == 0) break; // out of attempts, or the shared retry budget is spent
                    budget--;
                    t += Backoff(j, rolls[i][j].Jit);
                }
                if (!ok) { failed++; if (i < Essential) essentialFailed = true; }
                else if (i < Essential) usable = Math.Max(usable, t);
            }
        }
        else
        {
            int t = 0;
            bool ok = false;
            int timeout = 4 * rtt + 300;
            for (int j = 0; j < MaxAttempts; j++)
            {
                attempts++;
                int dur = rtt + TransferMs * Reqs;
                // The reply is 12 times bigger, so it is twice as likely to be hit by the loss.
                if (rolls[0][j].Roll >= Math.Min(100, 2 * lossPct) && dur <= timeout) { intervals.Add((t, t + dur)); t += dur; ok = true; break; }
                intervals.Add((t, t + timeout)); t += timeout;
                if (j == MaxAttempts - 1) break;
                t += Backoff(j, rolls[0][j].Jit);
            }
            if (ok) usable = t; else { failed = Reqs; essentialFailed = true; }
        }
        return (essentialFailed ? -1 : usable, attempts, failed, WakeUps(intervals));
    }

    // A fleet reconnects at the same moment. The server can serve 2,000 requests a second; the rest get an error and retry.
    const int ServerCapacity = 2000;
    const int FleetMaxAttempts = 8;

    static (int Peak, int Rejected, int GaveUp, int Finished) Fleet(int phones, bool jitter)
    {
        var next = MakeRng(11);
        var nextAt = new long[phones];
        var attempt = new int[phones];
        var pending = new HashSet<int>();
        for (int p = 0; p < phones; p++)
        {
            if (jitter) nextAt[p] = next() % 10000; // jitter: each phone waits 0 to 10 s first
            pending.Add(p);
        }
        int peak = 0, rejected = 0, gaveUp = 0, finished = 0;
        for (int sec = 0; sec < 300 && pending.Count > 0; sec++)
        {
            int s = sec;
            var arrivals = pending.Where(p => nextAt[p] / 1000 == s).OrderBy(p => nextAt[p]).ThenBy(p => p).ToList();
            if (arrivals.Count == 0) continue;
            peak = Math.Max(peak, arrivals.Count);
            for (int k = 0; k < arrivals.Count; k++)
            {
                int p = arrivals[k];
                if (k < ServerCapacity) { pending.Remove(p); finished = sec; continue; }
                rejected++;
                attempt[p]++;
                if (attempt[p] >= FleetMaxAttempts) { gaveUp++; pending.Remove(p); continue; }
                long delay = Math.Min(60000, 1000L * (1 << (attempt[p] - 1)));
                nextAt[p] += jitter ? next() % delay : delay; // full jitter spreads the retries; without it they come back in step
            }
        }
        return (peak, rejected, gaveUp, finished);
    }

    public static void Main()
    {
        var names = new Dictionary<string, string>
        {
            ["sequential"] = "sequential, fixed 1,000 ms timeout, immediate retry",
            ["parallel"] = "parallel, backoff with jitter, retry budget",
            ["batch"] = "one batched request",
        };
        foreach (var (loss, rtt) in new[] { (10, 300), (30, 300), (10, 1200) })
        {
            Console.WriteLine($"-- packet loss {loss}%, round trip {rtt} ms");
            foreach (var s in new[] { "sequential", "parallel", "batch" })
            {
                var r = LoadScreen(s, loss, rtt);
                string shown = r.Usable < 0 ? "never" : $"{r.Usable} ms";
                Console.WriteLine($"  {names[s]}: usable after {shown}; {r.Attempts} requests sent; {r.Failed} failed; {r.Wakes} radio wake-ups");
            }
        }
        Console.WriteLine("-- 10000 phones reconnect at once, server serves 2000 requests a second");
        foreach (var jitter in new[] { false, true })
        {
            var f = Fleet(10000, jitter);
            Console.WriteLine($"  {(jitter ? "with" : "without")} jitter: peak {f.Peak} requests/s, {f.Rejected} rejected, all served by second {f.Finished}, {f.GaveUp} gave up");
        }
    }
}
