// A deterministic single-server queue (M/M/1, FIFO) simulated event by event, then checked against Little's law L = lambda * W.
// A seeded LCG supplies the random numbers, so every run (and every language) prints the same text.
using System;
using System.Collections.Generic;
using System.Globalization;

public class Lcg
{
    private uint s;
    public Lcg(uint seed) { s = seed; }
    public double Next() // uniform in (0, 1]
    {
        s = unchecked(s * 1664525u + 1013904223u);
        return (s + 1.0) / 4294967296.0;
    }
    public double Exp(double mean) => -mean * Math.Log(Next()); // inverse transform sampling
}

public static class Program
{
    const double ServiceMs = 50;
    const int N = 20000;

    static string F2(double x) => x.ToString("F2", CultureInfo.InvariantCulture);

    static (double util, double wait, double L, double lambda, double W) Simulate(double rho)
    {
        var arrivals = new Lcg(12345);
        var services = new Lcg(67890);
        double meanGap = ServiceMs / rho; // utilisation = service time / gap between arrivals
        var arrive = new List<double>();
        var depart = new List<double>();
        double t = 0, free = 0, wait = 0, busy = 0;
        for (int i = 0; i < N; i++)
        {
            t += arrivals.Exp(meanGap);
            double service = services.Exp(ServiceMs);
            double start = Math.Max(t, free); // the server takes the job when it arrives or when it frees up
            wait += start - t;
            busy += service;
            free = start + service;
            arrive.Add(t);
            depart.Add(free);
        }
        // Integrate the number in system over time by walking arrivals (+1) and departures (-1) in order.
        double area = 0, last = 0;
        int inSystem = 0, a = 0, d = 0;
        while (d < N)
        {
            bool isArrival = a < N && arrive[a] <= depart[d];
            double now = isArrival ? arrive[a] : depart[d];
            area += inSystem * (now - last);
            last = now;
            if (isArrival) { inSystem++; a++; } else { inSystem--; d++; }
        }
        double sojourn = 0;
        for (int i = 0; i < N; i++) sojourn += depart[i] - arrive[i];
        return (busy / last, wait / N, area / last, (N / last) * 1000, sojourn / N);
    }

    public static int Main()
    {
        double previous = -1;
        Console.WriteLine("rho  util  wait_ms  theory_ms  L  lambda_per_s  W_ms  L-lambda*W");
        foreach (double rho in new[] { 0.5, 0.7, 0.8, 0.9, 0.95 })
        {
            var r = Simulate(rho);
            double theory = (rho / (1 - rho)) * ServiceMs; // M/M/1 mean wait
            double gap = Math.Abs(r.L - (r.lambda / 1000) * r.W);
            Console.WriteLine($"{F2(rho)} {F2(r.util)} {F2(r.wait)} {F2(theory)} {F2(r.L)} {F2(r.lambda)} {F2(r.W)} {gap.ToString("F6", CultureInfo.InvariantCulture)}");
            if (gap > 1e-6 * Math.Max(1, r.L)) { Console.Error.WriteLine("Little's law violated"); return 1; }
            if (r.wait <= previous) { Console.Error.WriteLine("wait must grow with load"); return 1; }
            previous = r.wait;
        }
        // Sizing: concurrency = rate x latency, then add headroom so the pool is not a hockey stick.
        double rate = 1000, latencyMs = 50, headroom = 0.7;
        double inFlight = rate * latencyMs / 1000;
        Console.WriteLine($"in flight: {F2(inFlight)}, pool at {F2(headroom)} target: {(int)Math.Ceiling(inFlight / headroom)}");
        return 0;
    }
}
