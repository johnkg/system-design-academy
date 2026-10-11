// A dependency resolver with caret ranges, a lockfile with SHA-256 integrity, a release-age gate and scoped registries.
// The "registries" are plain dictionaries and "today" is a number, so the demo is deterministic and offline.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

public record Rel(string Ver, int Day, Dictionary<string, string> Deps, string Code)
{
    public string Code { get; set; } = Code;
}
public record Entry(string Registry, string Version, string Hash);

public static class Program
{
    static int[] Vt(string v) => v.Split('.').Select(int.Parse).ToArray();
    static int Cmp(int[] a, int[] b) { for (var i = 0; i < 3; i++) if (a[i] != b[i]) return a[i] - b[i]; return 0; }

    static bool Satisfies(string v, string rng) // "^1.2.0" means >=1.2.0 <2.0.0 (majors here are all >= 1)
    {
        if (rng[0] != '^') return v == rng;
        var b = Vt(rng[1..]);
        return Cmp(Vt(v), b) >= 0 && Vt(v)[0] == b[0];
    }

    static string Sha(string code) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(code))).ToLowerInvariant()[..8];
    static Rel R(string ver, int day, Dictionary<string, string> deps, string code) => new(ver, day, deps, code);
    static Dictionary<string, string> D(params (string, string)[] d) => d.ToDictionary(x => x.Item1, x => x.Item2);

    static Dictionary<string, Dictionary<string, List<Rel>>> registries = new()
    {
        ["public"] = new()
        {
            ["webfw"] = new() { R("2.1.0", 1, D(("httputil", "^1.2.0")), "webfw 2.1.0"), R("2.1.4", 20, D(("httputil", "^1.2.0")), "webfw 2.1.4") },
            ["httputil"] = new() { R("1.2.0", 1, D(("textkit", "^3.0.0")), "httputil 1.2.0"), R("1.2.3", 10, D(("textkit", "^3.0.0")), "httputil 1.2.3") },
            ["textkit"] = new() { R("3.0.0", 1, D(), "textkit 3.0.0"), R("3.0.2", 5, D(), "textkit 3.0.2") },
        },
        ["private"] = new() { ["acme-billing"] = new() { R("1.4.2", 3, D(), "acme-billing 1.4.2 (internal)") } },
    };
    static Dictionary<string, string> Root = D(("webfw", "^2.1.0"), ("acme-billing", "^1.4.0"));

    static SortedDictionary<string, Entry> Resolve(int today, SortedDictionary<string, Entry>? lk = null, Dictionary<string, string>? scopes = null, int minAge = 0)
    {
        var plan = new SortedDictionary<string, Entry>(StringComparer.Ordinal);
        var queue = new List<(string, string)>(Root.OrderBy(x => x.Key, StringComparer.Ordinal).Select(x => (x.Key, x.Value)));
        while (queue.Count > 0)
        {
            var (name, rng) = queue[0]; queue.RemoveAt(0);
            if (plan.ContainsKey(name)) continue;
            string reg; Rel pick;
            if (lk != null && lk.ContainsKey(name)) // the lockfile wins: same registry, same version
            {
                reg = lk[name].Registry;
                pick = registries[reg][name].First(v => v.Ver == lk[name].Version);
            }
            else
            {
                var prefix = (scopes ?? new()).Keys.FirstOrDefault(p => name.StartsWith(p, StringComparison.Ordinal));
                var where = prefix != null ? new List<string> { scopes![prefix] } : registries.Keys.OrderBy(k => k, StringComparer.Ordinal).ToList(); // unscoped: every registry is searched
                var cands = new List<(string, Rel)>();
                foreach (var r in where)
                    if (registries[r].TryGetValue(name, out var list))
                        foreach (var v in list) if (Satisfies(v.Ver, rng) && today - v.Day >= minAge) cands.Add((r, v));
                (reg, pick) = cands.Aggregate((a, b) => Cmp(Vt(b.Item2.Ver), Vt(a.Item2.Ver)) > 0 ? b : a); // highest version wins, wherever it lives
            }
            plan[name] = new Entry(reg, pick.Ver, Sha(pick.Code));
            queue.AddRange(pick.Deps.OrderBy(x => x.Key, StringComparer.Ordinal).Select(x => (x.Key, x.Value)));
        }
        return plan;
    }

    static void Install(SortedDictionary<string, Entry> plan, bool verify) // download each artifact, then check it against the recorded hash
    {
        foreach (var (name, e) in plan)
        {
            var code = registries[e.Registry][name].First(v => v.Ver == e.Version).Code;
            if (verify && Sha(code) != e.Hash) throw new InvalidOperationException($"integrity mismatch for {name}@{e.Version}: want {e.Hash} got {Sha(code)}");
        }
    }

    static void Show(string label, SortedDictionary<string, Entry> plan) =>
        Console.WriteLine(label.PadRight(22) + string.Join(" ", plan.Select(p => $"{p.Key}@{p.Value.Version}/{p.Value.Registry[..3]}")));
    static string Flat(SortedDictionary<string, Entry> p) => string.Join("|", p.Select(x => $"{x.Key}:{x.Value}"));
    static void Must(bool c, string m) { if (!c) { Console.Error.WriteLine("invariant violated: " + m); Environment.Exit(1); } }

    public static void Main()
    {
        var acme = new Dictionary<string, string> { ["acme-"] = "private" };
        var lk = Resolve(30, scopes: acme);
        Show("day 30 fresh + lock", lk);
        registries["public"]["httputil"].Add(R("1.2.9", 40, D(("textkit", "^3.0.0")), "httputil 1.2.9 + steal(env)"));
        registries["public"]["acme-billing"] = new() { R("1.99.0", 40, D(), "acme-billing 1.99.0 (attacker)") };
        var floating = Resolve(41);
        var locked = Resolve(41, lk);
        var gated = Resolve(41, scopes: acme, minAge: 3);
        var scoped = Resolve(41, scopes: acme);
        Show("day 41 floating", floating);
        Show("day 41 lockfile", locked);
        Show("day 41 age gate 3d", gated);
        Show("day 41 scoped only", scoped);
        var h = registries["public"]["httputil"];
        h.RemoveAt(h.Count - 1); // yanked on day 43
        h[^1].Code = "httputil 1.2.3 + backdoor"; // same version, new bytes on a mirror
        Install(lk, false);
        Console.WriteLine("lock without check:   installed tampered bytes silently");
        try { Install(lk, true); Must(false, "tampered artifact was accepted"); }
        catch (InvalidOperationException e) { Console.WriteLine("lock with sha256:     " + e.Message); }

        Must(floating["httputil"].Version == "1.2.9" && Flat(locked) == Flat(lk), "lockfile keeps the build identical");
        Must(floating["acme-billing"].Registry == "public" && scoped["acme-billing"].Registry == "private", "scoping blocks confusion");
        Must(gated["httputil"].Version == "1.2.3", "age gate skips the fresh release");
        Console.WriteLine("invariants hold");
    }
}
