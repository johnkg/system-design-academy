// A paired comparison of two prompt versions with a bootstrap confidence interval and a CI gate, in C#:
// the same 400 test cases are graded for both versions, and the gate looks at the interval of the difference, not at the two pass rates alone.
using System;
using System.Linq;

class Program
{
    static ulong seed = 2026;
    static int Rnd(int n) { seed = (seed * 1664525UL + 1013904223UL) % 4294967296UL; return (int)((seed / 65536UL) % (ulong)n); }

    // Hundredths of a percentage point as text, using integers only.
    static string Pp(int h) => $"{(h < 0 ? "-" : "+")}{Math.Abs(h) / 100}.{(Math.Abs(h) % 100):D2}";

    const int N = 400;
    static int[] baseP = new int[N], cand = new int[N], diff = new int[N];

    // Bootstrap: resample the cases with replacement 1000 times and take the 2.5th and 97.5th percentile.
    static (int, int) Interval(Func<int> draw)
    {
        var sums = new int[1000];
        for (int r = 0; r < 1000; r++)
        {
            int s = 0;
            for (int k = 0; k < N; k++) s += draw();
            sums[r] = s;
        }
        Array.Sort(sums);
        return (sums[25] * 25, sums[974] * 25); // sum / 400 * 100 percent = sum * 25 hundredths
    }

    static int Main()
    {
        for (int i = 0; i < N; i++)
        {
            int hardness = Rnd(1000);                           // a hard case is hard for both versions
            baseP[i] = hardness < 700 ? 1 : 0;
            cand[i] = hardness + Rnd(200) - 100 < 730 ? 1 : 0;  // the new version is a little better on average
            diff[i] = cand[i] - baseP[i];                       // +1 fixed, -1 broken, 0 same
        }
        Console.WriteLine($"base {baseP.Sum()}/{N}, candidate {cand.Sum()}/{N}, fixed {diff.Count(x => x == 1)}, broken {diff.Count(x => x == -1)}");

        var (pLo, pHi) = Interval(() => diff[Rnd(N)]);                 // paired: one index, both versions
        var (uLo, uHi) = Interval(() => { int c = cand[Rnd(N)]; return c - baseP[Rnd(N)]; }); // unpaired: independent indexes
        Console.WriteLine($"paired 95% interval for the change: {Pp(pLo)} to {Pp(pHi)} points");
        Console.WriteLine($"unpaired interval would be:        {Pp(uLo)} to {Pp(uHi)} points");

        // Judge calibration: compare the LLM judge with human labels on 150 cases.
        int agree = 0, judgePass = 0, humanPass = 0;
        for (int i = 0; i < 150; i++)
        {
            int human = cand[i], judge = Rnd(100) < 88 ? human : 1 - human;
            agree += human == judge ? 1 : 0; judgePass += judge; humanPass += human;
        }
        Console.WriteLine($"judge agrees with humans on {agree}/150, judge passes {judgePass}, humans pass {humanPass}");

        // Gate: block if the lower end of the interval is worse than a 2 point regression budget.
        string gate = pLo > -200 ? "ship" : "block";
        string proven = pLo > 0 ? "improvement proven" : "improvement not proven";
        Console.WriteLine($"gate: {gate} ({proven})");
        return (!(pHi - pLo < uHi - uLo) || agree < 120 || gate != "ship") ? 1 : 0;
    }
}
