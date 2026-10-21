// Canary analysis: compare the canary's error rate with the stable version's, using integers only.
// Error rates are counts out of 10000 requests. Everything is seeded, so the output never changes.
using System;
using System.Linq;

public static class Program
{
    const int PerMin = 1000; // requests per minute across the whole service
    const int Stable = 100;  // the stable version fails 1.00% of requests

    const int RateScale = 10000;  // rates are counts out of this many requests
    const int PercentToRate = RateScale / 100;
    const long MinStableRate = 10; // 0.10%: the stable rate used is never below this
    const int ZtPerSigma = 10;     // zt is in tenths of a standard deviation
    const int FinalStage = 50;     // percent of traffic at the last canary stage
    static readonly int[] WiderStages = { 25, FinalStage };
    const int BaselineErrors = 1000, BaselineRequests = 100000; // the 1.00% baseline of the gate demo
    const int ThreeSigma = 3 * ZtPerSigma;
    const int MinSample = 300;

    // After the first share the canary widens to 25%, then 50%.
    static int[] NextStages(int share) => WiderStages.Where(s => s > share).ToArray();

    // The health gate. zt is the threshold in tenths of a standard deviation (30 = 3.0 sigma).
    // Is the canary's error count higher than the stable rate predicts, by more than zt/10 standard deviations?
    //   expected errors = cn * p / 10000, variance ~ expected, so:  x^2 >= (zt/10)^2 * variance * 10000^2
    static string Gate(long ce, long cn, long be, long bn, long zt, long minN)
    {
        if (cn == 0 || cn < minN) return "hold";            // too little data to judge
        long p = Math.Max(be * RateScale / bn, MinStableRate);          // stable rate, never below 0.10%
        long x = ce * RateScale - cn * p;                        // errors above expectation, scaled by 10000
        return x > 0 && x * x >= zt * zt * cn * p * (RateScale / (ZtPerSigma * ZtPerSigma)) ? "rollback" : "pass";
    }

    static void Rollout(string name, int share, int bake, int zt, int minN, int canaryRate, uint seed)
    {
        uint s = seed;
        int Rnd() { s = unchecked(s * 1664525u + 1013904223u); return (int)((s >> 8) % (uint)RateScale); } // 32-bit LCG
        var stages = new[] { share }.Concat(NextStages(share)).ToArray();
        int stage = 0, inStage = 0, failed = 0, canaryFailed = 0;
        int ce = 0, cn = 0, be = 0, bn = 0;
        string outcome = "";
        Console.WriteLine($"-- {name}: start {share}%, bake {bake} min, {zt / 10}.{zt % 10} sigma, min sample {minN}");
        for (int m = 1; outcome == ""; m++)
        {
            for (int i = 0; i < PerMin; i++)
            {
                bool toCanary = Rnd() < stages[stage] * PercentToRate;
                bool err = Rnd() < (toCanary ? canaryRate : Stable);
                if (toCanary) { cn++; if (err) { ce++; canaryFailed++; } } else { bn++; if (err) be++; }
                if (err) failed++;
            }
            inStage++;
            string verdict = Gate(ce, cn, be, bn, zt, minN);
            string action = verdict == "pass" ? "bake" : verdict;
            if (verdict == "pass" && inStage >= bake) action = stage == stages.Length - 1 ? "promote to 100%" : "widen";
            Console.WriteLine($"m{m} {stages[stage]}% canary {ce}/{cn} stable {be}/{bn} -> {action}");
            if (verdict == "rollback") outcome = "rolled back";
            else if (action == "promote to 100%") outcome = "promoted";
            else if (action == "widen") { stage++; inStage = 0; ce = cn = be = bn = 0; }
        }
        string truth = canaryRate > Stable ? "buggy" : "healthy";
        string result = outcome == "promoted" ? (truth == "buggy" ? "MISSED BUG" : "correct") : (truth == "buggy" ? "correct" : "FALSE ALARM");
        Console.WriteLine($"result: {outcome}, v2 is {truth} ({result}); failed {failed}, by v2 {canaryFailed}");
        if (outcome == "promoted" && stages[stage] != FinalStage) throw new Exception("promoted without passing the 50% stage");
        if (canaryFailed > failed) throw new Exception("v2 cannot fail more requests than the whole service");
    }

    public static void Main()
    {
        // The same gate on the same 1.00% baseline, judged on small and large canary samples.
        foreach (var (ce, cn) in new[] { (3, 100), (4, 100), (3, 300), (9, 300), (30, 1000) })
            Console.WriteLine($"gate({ce}/{cn} vs 1.00%, 3 sigma) = {Gate(ce, cn, BaselineErrors, BaselineRequests, ThreeSigma, 0)}");
        if (Gate(0, 0, 1, 100, ThreeSigma, 0) != "hold") throw new Exception("no data must hold");
        if (Gate(5, 100, BaselineErrors, BaselineRequests, ThreeSigma, MinSample) != "hold") throw new Exception("small sample must hold");

        Rollout("default gate, v2 buggy", share: 5, bake: 5, zt: ThreeSigma, minN: MinSample, canaryRate: 200, seed: 8);
        Rollout("judge at once, v2 buggy", share: 1, bake: 2, zt: ThreeSigma, minN: 0, canaryRate: 200, seed: 12);
        Rollout("judge at once, v2 healthy", share: 1, bake: 2, zt: 20, minN: 0, canaryRate: 100, seed: 7);
    }
}
