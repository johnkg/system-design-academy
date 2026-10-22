// Error budget and burn rate in C#. The numbers are passed in, so the output is deterministic.
using System;

public static class Program
{
    const int MinutesPerDay = 24 * 60;
    const int WindowDays = 30; // the SLO is measured over a rolling 30-day window
    const int PageBurnRate = 14; // burning this fast for an hour spends 2% of a 30-day budget: page a human

    // How much downtime does an SLO allow over a window?
    static double ErrorBudgetMinutes(double slo, int windowDays) => (1 - slo) * windowDays * MinutesPerDay;

    // Burn rate: how fast the budget is being spent compared with spending it evenly over the window.
    // 1.0 spends exactly the whole budget by the end of the window; 14 would spend it in about two days.
    static double BurnRate(double errorRatio, double slo) => errorRatio / (1 - slo);

    public static void Main()
    {
        foreach (var target in new[] { 0.99, 0.999, 0.9999 })
            Console.WriteLine($"SLO {target * 100:F2}% over 30 days allows {ErrorBudgetMinutes(target, WindowDays):F1} minutes of downtime");

        var slo = 0.999;
        var incidents = new[] { ("bad deploy", 20), ("provider blip", 5), ("slow day", 12) };
        var budget = ErrorBudgetMinutes(slo, WindowDays);
        double spent = 0;
        foreach (var (name, minutes) in incidents)
        {
            spent += minutes;
            Console.WriteLine($"after {name}: {budget - spent:F1} minutes left ({Math.Max(0, (budget - spent) / budget * 100):F0}%)");
        }
        Console.WriteLine(spent > budget ? "budget spent: freeze feature releases, fix reliability" : "budget remains: keep shipping");

        // A 2% error rate for an hour, against a 99.9% SLO
        var rate = BurnRate(0.02, slo);
        Console.WriteLine($"burn rate at 2% errors: {rate:F0}x{(rate >= PageBurnRate ? " -> page someone now" : "")}");
        Console.WriteLine($"burn rate at 0.05% errors: {BurnRate(0.0005, slo):F1}x (well within budget)");
    }
}
