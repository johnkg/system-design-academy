// Coverage and Mutation Testing: four test suites for one small discount function, measured two ways.
// Look for: line coverage says 100% for a suite that asserts nothing, while the mutation score (mutants killed) tells the truth.
// A "mutant" is the function with one small change (a > turned into >=, a + into -). A suite KILLS a mutant if some test fails on it.
// Mutant 6 is an equivalent mutant: it changes the code but not the behaviour, so no test can ever kill it.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    static long FloorDiv(long a, long b) { long q = a / b; return (a % b != 0 && (a < 0) != (b < 0)) ? q - 1 : q; }

    static int Discount(int total, bool member, string coupon, int m, Action<int> hit) // m = mutant to switch on, 0 for the real code
    {
        hit(1); int rate = 0;
        hit(2); if (m == 1 ? total > 100 : total >= 100) { hit(3); rate = m == 2 ? 0 : 10; }
        hit(4); if (m == 3 ? !member : member) { hit(5); rate += m == 4 ? -5 : 5; }
        hit(6);
        if (coupon == "SAVE5") { hit(7); rate += m == 5 ? 6 : 5; }
        else if (coupon == "SAVE10") { hit(8); rate += m == 10 ? 9 : 10; }
        hit(9); if (m == 6 ? rate >= 20 : rate > 20) { hit(10); rate = m == 7 ? 25 : 20; }
        hit(11); int off = m == 8 ? (int)-FloorDiv(-(long)total * rate, 100) : (int)FloorDiv((long)total * rate, 100); // ceil or floor
        hit(12); return m == 9 ? total + off : total - off;
    }

    const int Lines = 12;
    static readonly string[] Mutants =
    {
        ">= turned into >", "base rate 10 turned into 0", "member test negated", "member bonus + turned into -", "SAVE5 bonus 5 turned into 6",
        "cap > turned into >=", "cap value 20 turned into 25", "floor turned into ceil", "minus turned into plus", "SAVE10 bonus 10 turned into 9",
    };

    static long state;
    static int Rand(int n) { state = (state * 48271) % 2147483647; return (int)(state % n); }

    static int Reference(int total, bool member, string coupon) // an independent way to compute the answer, for the generated suite
    {
        int pct = (total >= 100 ? 10 : 0) + (member ? 5 : 0) + (coupon == "SAVE5" ? 5 : coupon == "SAVE10" ? 10 : 0);
        if (pct > 20) pct = 20;
        return total - total * pct / 100;
    }

    // a test is (total, member, coupon, expected); expected -1 means the test calls the code and asserts nothing
    record T(int Total, bool Member, string Coupon, int Want);

    static bool Passes(List<T> tests, int m) => tests.All(t => t.Want < 0 || Discount(t.Total, t.Member, t.Coupon, m, _ => { }) == t.Want);
    static int Coverage(List<T> tests)
    {
        var seen = new HashSet<int>();
        foreach (var t in tests) Discount(t.Total, t.Member, t.Coupon, 0, l => seen.Add(l));
        return seen.Count;
    }

    public static void Main()
    {
        var smoke = new List<T> { new(150, true, "SAVE10", -1), new(50, false, "", -1), new(100, false, "SAVE5", -1) };
        var happy = new List<T> { new(150, true, "SAVE10", 120), new(50, false, "", 50), new(100, false, "SAVE5", 85) };
        var edges = new List<T> { new(100, false, "", 90), new(99, false, "", 99), new(101, false, "", 91), new(200, true, "SAVE10", 160), new(100, true, "SAVE5", 80), new(50, true, "", 48), new(120, false, "SAVE10", 96) };
        state = 5;
        var coupons = new[] { "", "SAVE5", "SAVE10" };
        var generated = new List<T>();
        for (int i = 0; i < 60; i++)
        {
            int t = 95 + Rand(11); bool mem = Rand(2) == 1; string c = coupons[Rand(3)];
            generated.Add(new T(t, mem, c, Reference(t, mem, c)));
        }
        var suites = new (string, List<T>)[]
        {
            ("Smoke: runs the code, asserts nothing", smoke), ("Happy path: one assertion each", happy),
            ("Edges and combinations", edges), ("60 generated inputs against a reference", generated),
        };
        foreach (var (name, tests) in suites)
        {
            int asserts = tests.Count(t => t.Want >= 0), lines = Coverage(tests);
            var killed = Enumerable.Range(1, Mutants.Length).Select(i => !Passes(tests, i)).ToList();
            int k = killed.Count(x => x);
            Console.WriteLine($"{name}: {tests.Count} tests, {asserts} assertions, passes {Passes(tests, 0).ToString().ToLower()}");
            Console.WriteLine($"  line coverage {lines}/{Lines} = {100 * lines / Lines}%, mutants killed {k}/{Mutants.Length} = {100 * k / Mutants.Length}%, mutation run cost {tests.Count * (Mutants.Length + 1)}");
            var survivors = Enumerable.Range(0, Mutants.Length).Where(i => !killed[i]).Select(i => Mutants[i]).ToList();
            Console.WriteLine($"  survivors: {(survivors.Count > 0 ? string.Join("; ", survivors) : "none")}");
        }
    }
}
