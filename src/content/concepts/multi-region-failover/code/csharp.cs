// Simulate losing region A while region B holds a standby copy. Integer milliseconds and a seeded
// generator make the run reproducible. It measures RTO (downtime), RPO (acknowledged writes lost
// to replication lag) and the split-brain writes the old primary accepts when it comes back.
using System;
using System.Linq;

const long FailAt = 25000;

var b0 = new Params(false, 500, 60000, 10000, 3, 45000, false);
var scenarios = new (string, Params)[] {
    ("async, warm standby, no fencing", b0),
    ("async, warm standby, fencing", b0 with { Fencing = true }),
    ("sync replication, fencing", b0 with { Sync = true, Fencing = true }),
    ("fast config: hot standby, TTL 5s, 5s checks x2", b0 with { TtlMs = 5000, IntervalMs = 5000, Threshold = 2, PromoteMs = 2000, Fencing = true }),
};
var outs = scenarios.Select(s => (s.Item1, Sim.Run(s.Item2))).ToArray();
foreach (var (name, r) in outs) {
    Console.WriteLine(name);
    Console.WriteLine($"  detected at {r.DetectAt}ms, promoted at {r.PromoteAt}ms, old region back at {r.BackAt}ms");
    Console.WriteLine($"  RTO all clients {r.RtoMs}ms, half of clients {r.P50Ms}ms");
    Console.WriteLine($"  RPO: {r.Lost} of {r.Acked} acked writes lost, window {r.RpoMs}ms");
    Console.WriteLine($"  writes rejected {r.Failed}, fenced {r.Fenced}, split-brain {r.Diverged}");
}
var (a, b, s, f) = (outs[0].Item2, outs[1].Item2, outs[2].Item2, outs[3].Item2);
var fence = new Fence(100);
if (!(fence.Accepts(1, 99) && !fence.Accepts(1, 100) && fence.Accepts(2, 100))) Environment.Exit(1);
bool ok = a.Diverged > 0 && b.Diverged == 0 && b.Fenced == a.Diverged && a.Lost == b.Lost && a.Lost > 0
    && s.Lost == 0 && s.RpoMs == 0 && f.RtoMs < a.RtoMs && a.RtoMs >= a.PromoteAt - FailAt;
Console.WriteLine($"invariants hold: {(ok ? "true" : "false")}");
if (!ok) Environment.Exit(1);

record Params(bool Sync, long LagMs, long TtlMs, long IntervalMs, long Threshold, long PromoteMs, bool Fencing);
record Result(long DetectAt, long PromoteAt, long BackAt, long Acked, long Lost, long RpoMs, long RtoMs, long P50Ms, long Failed, long Fenced, long Diverged);

// A fencing token authority: every promotion bumps the epoch, and storage rejects older epochs.
class Fence(long promoteAt) {
    public int EpochAt(long t) => t >= promoteAt ? 2 : 1;
    public bool Accepts(int writerEpoch, long t) => writerEpoch >= EpochAt(t);
}

class Sim {
    public const long SyncRtt = 80, BackAfterPromote = 15000;
    public const int Clients = 100;
    public static Result Run(Params p) {
        long x = 42;
        long Rng(long n) { x = (x * 48271) % 2147483647; return x % n; }
        // 1. Failure detection: health checks run every interval; N consecutive failures declare A dead.
        long firstBadCheck = (25000 + p.IntervalMs - 1) / p.IntervalMs * p.IntervalMs;
        long detectAt = firstBadCheck + (p.Threshold - 1) * p.IntervalMs;
        // 2. Promotion: the standby is started or scaled up and made writable (epoch 1 -> 2), then DNS flips.
        long promoteAt = detectAt + p.PromoteMs;
        var fence = new Fence(promoteAt);
        long backAt = promoteAt + BackAfterPromote;
        // 3. Each client cached the old DNS answer at some random moment, so it keeps using A until its TTL ends.
        var recoverAt = new long[Clients];
        for (int c = 0; c < Clients; c++) recoverAt[c] = promoteAt + Rng(p.TtlMs);
        long horizon = recoverAt.Max() + 1000;
        // 4. A seeded write stream (about 10 per second), replicated to B in order after a random lag.
        long t = 0, applied = 0, acked = 0, lost = 0, oldestLost = -1, failed = 0, fenced = 0, diverged = 0;
        while (true) {
            t += 50 + Rng(100);
            if (t >= horizon) break;
            long client = Rng(Clients);
            long lag = p.LagMs * (50 + Rng(100)) / 100;
            if (t < 25000) {
                if (p.Sync && t + SyncRtt > 25000) { failed++; continue; } // never acknowledged: the client retries
                acked++;
                applied = Math.Max(applied, t + (p.Sync ? SyncRtt : lag)); // in-order apply on B
                if (!p.Sync && applied > 25000) { lost++; if (oldestLost < 0) oldestLost = t; }
            } else if (t < recoverAt[client]) { // this client still resolves to A
                if (t < backAt) failed++;                                   // A is down
                else if (!p.Fencing || fence.Accepts(1, t)) diverged++;     // A is back, still thinks it is primary
                else fenced++;                                              // the stale epoch is rejected
            }
        }
        var sorted = recoverAt.OrderBy(v => v).ToArray();
        return new Result(detectAt, promoteAt, backAt, acked, lost, oldestLost < 0 ? 0 : 25000 - oldestLost,
            sorted[Clients - 1] - 25000, sorted[Clients / 2] - 25000, failed, fenced, diverged);
    }
}
