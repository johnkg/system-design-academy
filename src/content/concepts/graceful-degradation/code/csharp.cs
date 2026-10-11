// Page assembly with per-dependency timeouts and fallbacks over a seeded set of failures.
// Compares a naive page (everything critical, no fallbacks) with a degrading one.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    record Dep(string Name, int Base, int Hit); // Hit = fallback hit rate in percent
    record Cfg(bool AllCritical, bool Fallbacks, int OptionalTimeout);
    record Page(string Outcome, int Ms);

    const int N = 100, CriticalTimeout = 2000, UsableMs = 1000;
    static long seed = 12345;
    static long Next() { seed = (seed * 48271) % 2147483647; return seed; }

    static (bool Ok, int Ms) CallDep(int b, string mode, long a)
    {
        if (mode == "down") return (false, 15 + (int)(a % 25)); // fails fast
        if (mode == "slow") return (true, 1500 + (int)(a % 1000));
        return (true, b + (int)(a % b));
    }

    static Page Assemble(Dep[] deps, Dictionary<string, string> modes, Cfg cfg, long[][] req)
    {
        int slowest = 0, errorAt = -1, substituted = 0, missing = 0;
        for (int i = 0; i < deps.Length; i++)
        {
            var dep = deps[i];
            bool critical = i == 0 || cfg.AllCritical;
            int limit = critical ? CriticalTimeout : cfg.OptionalTimeout;
            var (ok, ms) = CallDep(dep.Base, modes.GetValueOrDefault(dep.Name, "up"), req[i][0]);
            if (ok && ms > limit) { ok = false; ms = limit; } // timed out
            if (ok) { slowest = Math.Max(slowest, ms); continue; }
            if (critical) { errorAt = errorAt < 0 ? ms : Math.Min(errorAt, ms); continue; }
            slowest = Math.Max(slowest, ms);
            if (cfg.Fallbacks && req[i][1] % 100 < dep.Hit) substituted++; else missing++;
        }
        if (errorAt >= 0) return new Page("error", errorAt + 15);
        return new Page(substituted + missing > 0 ? "degraded" : "full", slowest + (substituted > 0 ? 5 : 0) + 15);
    }

    public static void Main()
    {
        var deps = new[] { new Dep("product", 80, 0), new Dep("reviews", 60, 90), new Dep("recs", 120, 100), new Dep("inventory", 40, 70), new Dep("personal", 70, 100) };
        var scenarios = new (string Label, Dictionary<string, string> Modes)[] {
            ("healthy", new()), ("reviews down", new() { ["reviews"] = "down" }), ("recs slow", new() { ["recs"] = "slow" }),
            ("inventory down", new() { ["inventory"] = "down" }), ("product down", new() { ["product"] = "down" }) };
        var configs = new[] { ("naive", new Cfg(true, false, CriticalTimeout)), ("degrading", new Cfg(false, true, 300)) };

        // One fixed set of random draws per request, shared by every configuration.
        var draws = new long[N][][];
        for (int r = 0; r < N; r++) { draws[r] = new long[deps.Length][]; for (int d = 0; d < deps.Length; d++) { long a = Next(); long b = Next(); draws[r][d] = new[] { a, b }; } }

        var results = new Dictionary<string, (int Full, int Degraded, int Error, int P95, int Usable)>();
        foreach (var (label, modes) in scenarios)
            foreach (var (cname, cfg) in configs)
            {
                var pages = draws.Select(req => Assemble(deps, modes, cfg, req)).ToList();
                int Count(string o) => pages.Count(p => p.Outcome == o);
                var lat = pages.Select(p => p.Ms).OrderBy(x => x).ToList();
                int usable = pages.Count(p => p.Outcome != "error" && p.Ms <= UsableMs);
                var res = (Count("full"), Count("degraded"), Count("error"), lat[N * 95 / 100], usable);
                results[label + "/" + cname] = res;
                Console.WriteLine($"{label,-15} {cname,-10} full={res.Item1,3} degraded={res.Item2,3} error={res.Item3,3} p95={res.Item4,4}ms usable={res.Item5,3}%");
            }

        // Invariants: an optional failure never fails the degrading page; a critical failure always does.
        foreach (var (label, _) in scenarios)
        {
            var d = results[label + "/degrading"];
            if (label == "product down") { if (d.Error != N) throw new Exception("critical failure must fail every page"); }
            else if (d.Error != 0) throw new Exception("optional failure failed a page: " + label);
        }
        if (results["reviews down/naive"].Error != N) throw new Exception("naive page should fail when reviews is down");
        if (results["recs slow/degrading"].P95 > 320) throw new Exception("optional timeout must bound page latency");
        if (results["recs slow/naive"].P95 <= 1000) throw new Exception("naive page should be slow when recs is slow");
        Console.WriteLine("invariants hold");
    }
}
