// A mobile backend-for-frontend (BFF) in C#:
// one home-screen request fans out to five services in parallel, each with its own timeout,
// optional parts may be missing (a partial response), the body is shaped to what the app version needs, and an ETag lets the app skip an unchanged body.
using System;
using System.Collections.Generic;
using System.Linq;

// Since: the first app version that shows this part. Required: without it there is no screen. Timeout in ms.
record Service(string Name, bool Required, int Since, int Timeout, int Base, int Spread);
record Result(int Status, string Body, List<string> Degraded, int Raw, int Parallel, int Sequential, string Etag);

static class Bff
{
    public static readonly Service[] Services =
    {
        new("profile", true, 1, 120, 30, 40),
        new("orders", true, 1, 150, 40, 60),
        new("recs", false, 1, 100, 40, 120),
        new("promos", false, 3, 80, 20, 100),
        new("inbox", false, 1, 80, 15, 30),
    };
    const int RawExtra = 300; // bytes each service returns that this screen never shows
    const int ShownBytes = 12; // bytes of each service's reply that the screen does show
    const int HangPercent = 3, HangMs = 2000;

    const int Seed = 7;
    static long seed = Seed;
    // Linear congruential generator (Numerical Recipes constants), high 16 bits.
    static int Rnd(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)((seed / 65536) % n); }
    static int Latency(Service s) { int l = s.Base + Rnd(s.Spread); return Rnd(100) < HangPercent ? HangMs : l; } // 3% of calls hang

    // FNV-1a, 32 bits: a cheap stand-in for the hash behind an ETag.
    public static string EtagOf(string text)
    {
        uint h = 2166136261;
        foreach (char ch in text) h = unchecked((h ^ ch) * 16777619u);
        return h.ToString("x8");
    }

    public static Result Handle(int user, int version)
    {
        var plan = Services.Where(s => s.Since <= version).ToList();           // an old app never triggers a call it cannot show
        var calls = plan.Select(s => (s, ms: Latency(s))).ToList();
        var waits = calls.Select(c => Math.Min(c.ms, c.s.Timeout)).ToList();   // each call is cut off at its own timeout
        var parts = new List<string>(); var degraded = new List<string>();
        int raw = 0; bool failedRequired = false;
        foreach (var (s, ms) in calls)
        {
            if (ms <= s.Timeout) { parts.Add($"{s.Name}={(user * 7 + s.Name.Length) % 100}"); raw += RawExtra + ShownBytes; }
            else if (s.Required) failedRequired = true;
            else degraded.Add(s.Name);
        }
        string body = string.Join(";", parts);
        return new Result(failedRequired ? 503 : 200, body, degraded, raw, waits.Max(), waits.Sum(), EtagOf(body));
    }
}

class Program
{
    static int Mean(List<int> a) => a.Sum() / a.Count;

    static int Main()
    {
        const int N = 200;
        const int Users = 20, NewVersion = 3, OldVersion = 2, P95BudgetMs = 150;
        var last = new Dictionary<int, string>();
        var times = new List<int>(); var seq = new List<int>();
        int ok = 0, partial = 0, errors = 0, notModified = 0, shaped = 0, wire = 0, raw = 0;
        for (int i = 0; i < N; i++)
        {
            int user = i % Users, version = i % 2 == 0 ? NewVersion : OldVersion;
            var r = Bff.Handle(user, version);
            times.Add(r.Parallel); seq.Add(r.Sequential);
            if (r.Status != 200) { errors++; continue; }
            ok++; if (r.Degraded.Count > 0) partial++;
            shaped += r.Body.Length; raw += r.Raw;
            if (last.TryGetValue(user, out var prev) && prev == r.Etag) notModified++; // the app sent If-None-Match, so the reply is 304 with no body
            else wire += r.Body.Length;
            last[user] = r.Etag;
        }
        times.Sort();
        int p95 = times[N * 95 / 100];
        Console.WriteLine($"requests {N}: {ok} ok ({partial} partial), {errors} failed");
        Console.WriteLine($"parallel mean {Mean(times)} ms, p95 {p95} ms; one after another would average {Mean(seq)} ms");
        Console.WriteLine($"not modified {notModified}; bytes: {raw} from the services, {shaped} after shaping, {wire} on the wire");
        Console.WriteLine($"ETag of 'a=1': {Bff.EtagOf("a=1")}");
        bool good = p95 <= P95BudgetMs && Mean(seq) > Mean(times) && shaped < raw && wire < shaped && ok + errors == N && notModified > 0;
        return good ? 0 : 1;
    }
}
