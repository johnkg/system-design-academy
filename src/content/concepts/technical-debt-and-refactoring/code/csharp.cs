// Technical debt and refactoring: a team with 40 points of work per sprint, in code that carries 30 points of debt.
// Debt is the interest rate: in code the team changes every sprint ("hot" code), each feature costs 10 points plus one
// extra point for every 10 points of debt, and each rushed feature adds 2 more points of debt.
// Look for: how features delivered change with the strategy, what refactoring without tests costs, how a rewrite
// that takes longer than planned never catches up, and why debt in code nobody touches costs nothing.
// Assumptions of the toy: a refactoring step costs 8 points and removes 6 points of debt. Without tests, every third
// sprint's refactoring causes a regression that costs 12 points to find and fix. A rewrite delivers no features
// while it runs, then starts with 5 points of debt. A feature that does not fit in what is left of a sprint waits.
using System;
using System.Linq;

public static class Program
{
    const int Cap = 40, StartDebt = 30, NewDebt = 2, RefactorCost = 8, RefactorGain = 6, RegressionCost = 12, RewriteDebt = 5, BaseCost = 10;
    record Strategy(string Name, string Kind, int Rewrite);

    static readonly Strategy[] Strategies =
    {
        new("Ignore the debt", "ignore", 0),
        new("Small steps every sprint", "small", 0),
        new("Rewrite, 3 sprints", "rewrite", 3),
        new("Rewrite, 6 sprints", "rewrite", 6),
        new("Rewrite, 12 sprints", "rewrite", 12),
    };

    static (int Features, int Debt, int Cost, int Regressions, int[] Cumulative) Simulate(Strategy st, int sprints, bool tests, bool hot)
    {
        int debt = StartDebt, features = 0, regressions = 0;
        int Cost() => BaseCost + (hot ? debt / 10 : 0);
        var cumulative = new int[sprints];
        for (int s = 1; s <= sprints; s++)
        {
            int cap = Cap;
            if (st.Kind == "rewrite" && s <= st.Rewrite) { cap = 0; if (s == st.Rewrite) debt = RewriteDebt; }
            if (st.Kind == "small")
            {
                cap -= RefactorCost; debt = Math.Max(0, debt - RefactorGain);
                if (!tests && s % 3 == 0) { cap -= RegressionCost; regressions++; }
            }
            while (cap >= Cost()) { cap -= Cost(); features++; debt += NewDebt; }
            cumulative[s - 1] = features;
        }
        return (features, debt, Cost(), regressions, cumulative);
    }

    // First sprint from which a strategy stays ahead of ignoring the debt (checked over 60 sprints); -1 if it never does.
    static int Overtakes(Strategy st, bool tests, bool hot)
    {
        var a = Simulate(st, 60, tests, hot).Cumulative;
        var baseline = Simulate(Strategies[0], 60, tests, hot).Cumulative;
        int from = -1;
        for (int i = 59; i >= 0; i--) { if (a[i] > baseline[i]) from = i + 1; else break; }
        return from;
    }

    public static void Main()
    {
        foreach (bool hot in new[] { true, false })
        {
            foreach (bool tests in new[] { true, false })
            {
                Console.WriteLine($"== debt in {(hot ? "hot code (changed every sprint)" : "cold code (nobody touches it)")}, {(tests ? "with" : "without")} tests around it");
                for (int k = 0; k < Strategies.Length; k++)
                {
                    var st = Strategies[k];
                    var cells = new[] { 6, 12, 24 }.Select(n => Simulate(st, n, tests, hot).Features);
                    var r = Simulate(st, 24, tests, hot);
                    int ov = k == 0 ? 0 : Overtakes(st, tests, hot);
                    string o = k == 0 ? "n/a" : ov < 0 ? "never" : $"sprint {ov}";
                    Console.WriteLine($"  {st.Name}: features after 6, 12, 24 sprints: {string.Join(", ", cells)}; at 24: debt {r.Debt}, one feature costs {r.Cost} points, regressions {r.Regressions}; stays ahead of ignoring from: {o}");
                }
            }
        }
    }
}
