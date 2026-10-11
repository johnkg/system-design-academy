// Canary analysis: compare the canary's error rate with the stable version's, using integers only.
// Error rates are counts out of 10000 requests. Everything is seeded, so the output never changes.
using System;
using System.Linq;

public static class Program
{
    const int PerMin = 1000; // requests per minute across the whole service
    const int Stable = 100;  // the stable version fails 1.00% of requests

    // After the first share the canary widens to 25%, then 50%.
    static int[] NextStages(int share) => new[] { 25, 50 }.Where(s => s > share).ToArray();

    // The health gate. zt is the threshold in tenths of a standard deviation (30 = 3.0 sigma).
    // Is the canary's error count higher than the stable rate predicts, by more than zt/10 standard deviations?
    //   expected errors = cn * p / 10000, variance ~ expected, so:  x^2 >= (zt/10)^2 * variance * 10000^2
    static string Gate(long ce, long cn, long be, long bn, long zt, long minN)
    {
        if (cn == 0 || cn < minN) return "hold";            // too little data to judge
        long p = Math.Max(be * 10000 / bn, 10);              // stable rate, never below 0.10%
        long x = ce * 10000 - cn * p;                        // errors above expectation, scaled by 10000
        return x > 0 && x * x >= zt * zt * cn * p * 100 ? "rollback" : "pass";
    }

    static void Rollout(string name, int share, int bake, int zt, int minN, int canaryRate, uint seed)
    {
        uint s = seed;
        int Rnd() { s = unchecked(s * 1664525u + 1013904223u); return (int)((s >> 8) % 10000u); } // 32-bit LCG
        var stages = new[] { share }.Concat(NextStages(share)).ToArray();
        int stage = 0, inStage = 0, failed = 0, canaryFailed = 0;
        int ce = 0, cn = 0, be = 0, bn = 0;
        string outcome = "";
        Console.WriteLine($"-- {name}: start {share}%, bake {bake} min, {zt / 10}.{zt % 10} sigma, min sample {minN}");
        for (int m = 1; outcome == ""; m++)
        {
            for (int i = 0; i < PerMin; i++)
            {
                bool toCanary = Rnd() < stages[stage] * 100;
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
        if (outcome == "promoted" && stages[stage] != 50) throw new Exception("promoted without passing the 50% stage");
        if (canaryFailed > failed) throw new Exception("v2 cannot fail more requests than the whole service");
    }

    public static void Main()
    {
        // The same gate on the same 1.00% baseline, judged on small and large canary samples.
        foreach (var (ce, cn) in new[] { (3, 100), (4, 100), (3, 300), (9, 300), (30, 1000) })
            Console.WriteLine($"gate({ce}/{cn} vs 1.00%, 3 sigma) = {Gate(ce, cn, 1000, 100000, 30, 0)}");
        if (Gate(0, 0, 1, 100, 30, 0) != "hold") throw new Exception("no data must hold");
        if (Gate(5, 100, 1000, 100000, 30, 300) != "hold") throw new Exception("small sample must hold");

        Rollout("default gate, v2 buggy", 5, 5, 30, 300, 200, 8);
        Rollout("judge at once, v2 buggy", 1, 2, 30, 0, 200, 12);
        Rollout("judge at once, v2 healthy", 1, 2, 20, 0, 100, 7);
    }
}
