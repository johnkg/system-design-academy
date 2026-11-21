// A mobile release over 30 days for 1,000,000 active users. Version 7 goes out through a staged store rollout (1%, 5%, 20%,
// 50%, 100%) and may carry a bug. The run shows how fast the bug is found, how it is stopped, who is left on it and who is
// locked out. Day 0 is a Thursday. All numbers are integers; the only randomness is the seeded generator below, which the
// automatic gate uses to sample users, so the output never changes.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const int Days = 30;
    const long Users = 1000000;
    static readonly long[] OldMix = { 600000, 220000, 180000 }; // users on v6, v5, and v4 or older on the day v7 ships
    const long StuckPct = 13;    // 8% never update and 5% have a phone too old for the update: they stay where they are
    const long OrganicPct = 15;  // of the willing users the store offers the update to, this share installs it each day
    const long HotfixPct = 25;   // of the users on the broken build, this share installs the fix each day
    const long StickyPct = 3;    // users on the broken build who never take the fix (they have switched updates off)
    const long ForcedPct = 70;   // of the willing users behind a forced-upgrade screen, this share updates each day
    const int FloorDay = 14;     // the day the minimum supported version is raised
    const int FixDays = 1;       // a day to fix, build and test before the hotfix is submitted to the store
    const int HaltDays = 3;      // how long a false alarm freezes the rollout while people look
    const long BasePm = 5;       // 5 in 1,000 users crash on an ordinary day, on any healthy version
    const long MarginPm = 3;     // the gate halts when the new version is worse than the old one by more than this
    const long Tickets = 3000;   // with no monitoring, support tickets and store reviews notice at this many hurt users
    const int TicketLag = 3;     // days from that moment until a fix or a switch-off is under way
    const long ReviewMin = 5000; // a person does not act on fewer users than this on the new version
    const long Seed = 20261120;

    // store share on the u-th unfrozen day
    static long StageAt(int u) => u < 2 ? 1 : u < 4 ? 5 : u < 7 ? 20 : u < 10 ? 50 : 100;
    static bool Weekday(int d) => (d + 3) % 7 < 5; // day 0 is a Thursday

    static void Run(string name, string bug, long bugPm, string monitor, int sample, string kill, int delay, string floor)
    {
        long rng = Seed;
        long Rand() { rng = rng * 48271 % 2147483647; return rng; } // Park-Miller: the same numbers in every language

        var W = OldMix.Select(c => c * (100 - StuckPct) / 100).ToArray(); // willing to update, by old version
        var S = OldMix.Select((c, i) => c - W[i]).ToArray();              // stuck where they are
        long U = W.Sum();
        int[] blocked = floor == "v5" ? new[] { 2 } : floor == "v6" ? new[] { 1, 2 } : floor == "v7" ? new[] { 0, 1, 2 } : new int[0];
        bool flagRoute = bug == "flag" && kill == "flag";
        long nV7 = 0, nFix = 0, adopted = 0, hits = 0, aff = 0, bugDays = 0, lockedStuck = 0, sticky = 0;
        long stage = 0; int unfrozen = 0, F = -1, H = -1, freezeUntil = 0, falseHalts = 0, full = -1;
        var suffer = new List<long>(); var endNew = new List<long>(); var endAff = new List<long>();
        for (int d = 0; d < Days; d++)
        {
            if (flagRoute && F >= 0 && d >= F) aff = 0; // the flag is off: nobody hits the bug any more
            if (monitor == "review" && F < 0 && bug != "none" && Weekday(d) && d > 0)
            {
                // a person reads yesterday's dashboard: enough users, and a crash rate at least double the old one
                if (endNew[d - 1] >= ReviewMin && 1000 * endAff[d - 1] >= BasePm * endNew[d - 1]) F = d + 1;
            }
            if (F >= 0 && !flagRoute && H < 0) H = F + FixDays + delay; // the hotfix day, after store review
            bool halted = d < freezeUntil || (F >= 0 && !flagRoute && d >= F && d < H);
            if (d == H) sticky = nV7 * StickyPct / 100;
            if (H >= 0 && d >= H)
            {
                long mig = (nV7 - sticky) * HotfixPct / 100;
                if (nV7 > 0) aff = aff * (nV7 - mig) / nV7;
                nV7 -= mig; nFix += mig;
            }
            if (H >= 0 && d >= H) stage = 100; // the hotfix goes to everyone at once
            else if (!halted) { stage = StageAt(unfrozen); unfrozen++; }
            if (stage == 100 && full < 0) full = d;
            int today = d;
            void Adopt(long x)
            {
                if (x <= 0) return;
                adopted += x;
                if (H >= 0 && today >= H) { nFix += x; return; }
                nV7 += x;
                if (bug != "none" && !(flagRoute && F >= 0 && today >= F)) { long a = x * bugPm / 1000; hits += a; aff += a; }
            }
            if (d == FloorDay) foreach (int b in blocked) { lockedStuck += S[b]; S[b] = 0; }
            if (d >= FloorDay && !halted && stage == 100)
            {
                foreach (int b in blocked) { long m = W[b] * ForcedPct / 100; W[b] -= m; Adopt(m); }
            }
            if (!halted)
            {
                long sumW = W.Sum();
                long want = Math.Min(sumW, (U * stage / 100 - adopted) * OrganicPct / 100);
                if (want > 0)
                {
                    long given = 0;
                    var take = W.Select(w => { long t = want * w / sumW; given += t; return t; }).ToArray();
                    for (int b = 0; b < 3 && given < want; b++) { long e = Math.Min(W[b] - take[b], want - given); take[b] += e; given += e; }
                    for (int b = 0; b < 3; b++) W[b] -= take[b];
                    Adopt(want);
                }
            }
            suffer.Add(aff); endNew.Add(nV7 + nFix); endAff.Add(aff); bugDays += aff;
            if (F < 0 && bug != "none" && monitor == "none" && hits >= Tickets) F = d + TicketLag;
            if (F < 0 && monitor == "gate" && nV7 + nFix >= sample && d >= freezeUntil)
            {
                // the gate samples this many users of the new version and compares their crash rate with the old version's
                long pm = BasePm * 1000 + aff * 1000000 / (nV7 + nFix); // crashes per million users
                long c = 0;
                for (int i = 0; i < sample; i++) if (Rand() % 1000000 < pm) c++;
                if (c * 1000 > sample * (BasePm + MarginPm))
                {
                    if (aff > 0) F = d + 1;                                    // a real bug: stop and fix
                    else { freezeUntil = d + 1 + HaltDays; falseHalts++; }     // noise: the rollout stops for a few days for nothing
                }
            }
        }
        long peak = 0; int contained = -1; // contained: the first day fewer than a tenth of the peak number of users are still being hit
        for (int d = 0; d < suffer.Count; d++)
        {
            long s = suffer[d];
            if (s > peak) { peak = s; contained = -1; } else if (contained < 0 && s * 10 < peak) contained = d;
        }
        bool liveBug = bug != "none" && !(flagRoute && F >= 0);
        long locked = lockedStuck + blocked.Sum(b => W[b]);
        var old = W.Select((w, i) => (blocked.Contains(i) ? 0 : w) + S[i]).ToArray();
        if (nV7 + nFix + old.Sum() + locked != Users) throw new Exception("users lost");
        Console.WriteLine($"-- {name}");
        string verdict = bug == "none" ? "no bug" : contained < 0 ? "not contained in 30 days" : $"contained on day {contained}";
        Console.WriteLine($"  bug: {hits} users hit it, {bugDays} user-days with it, {verdict}");
        Console.WriteLine($"  rollout: store at 100% on day {(full < 0 ? "never" : full.ToString())}, {falseHalts} false halts, {(liveBug ? nV7 : 0)} users still on the broken version");
        Console.WriteLine($"  mix: v7 {nV7}, v7.1 {nFix}, v6 {old[0]}, v5 {old[1]}, v4 or older {old[2]}, locked out {locked}");
    }

    public static void Main()
    {
        Run("3% crash, no monitoring, new build only", "crash", 30, "none", 2000, "build", 3, "none");
        Run("3% crash, daily review", "crash", 30, "review", 2000, "build", 3, "none");
        Run("3% crash, automatic gate on 2000 users", "crash", 30, "gate", 2000, "build", 3, "none");
        Run("3% crash, automatic gate on 20000 users", "crash", 30, "gate", 20000, "build", 3, "none");
        Run("3% crash, gate, 7 days of store review for the hotfix", "crash", 30, "gate", 2000, "build", 7, "none");
        Run("bug behind a flag, gate, server flag", "flag", 30, "gate", 2000, "flag", 3, "none");
        Run("crash in the build, gate, server flag", "crash", 30, "gate", 2000, "flag", 3, "none");
        Run("healthy release, gate on 200 users", "none", 30, "gate", 200, "build", 3, "none");
        Run("healthy release, gate on 20000 users", "none", 30, "gate", 20000, "build", 3, "none");
        Run("3% crash, gate, minimum version v7 on day 14", "crash", 30, "gate", 2000, "build", 3, "v7");
        Run("3% crash, gate, minimum version v5 on day 14", "crash", 30, "gate", 2000, "build", 3, "v5");
    }
}
