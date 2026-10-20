// A package registry in C#:
// immutable publishes stored by content hash, semver range resolution over a dependency graph, and an integrity check on install.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

public record Meta(List<(string Name, string Range)> Deps, string Integrity, bool Yanked);

public static class Semver
{
    public static string Sha(string text) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
    public static int[] Parse(string v) => v.Split('.').Select(int.Parse).ToArray();
    public static int Cmp(int[] a, int[] b) { for (int i = 0; i < 3; i++) if (a[i] != b[i]) return a[i] < b[i] ? -1 : 1; return 0; }

    // Turn a range such as "^1.2.0", "~1.4.0" or ">=1.1.0 <2.0.0" into a list of (operator, version) tests that must all pass.
    static List<(string Op, int[] V)> Comparators(string range)
    {
        var tests = new List<(string, int[])>();
        foreach (var tok in range.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            if (tok == "*") continue;
            if (tok[0] == '^') // compatible: the left-most non-zero number may not change
            {
                var v = Parse(tok[1..]);
                tests.Add((">=", v));
                tests.Add(("<", v[0] > 0 ? new[] { v[0] + 1, 0, 0 } : v[1] > 0 ? new[] { 0, v[1] + 1, 0 } : new[] { 0, 0, v[2] + 1 }));
            }
            else if (tok[0] == '~') // patch updates only
            {
                var v = Parse(tok[1..]);
                tests.Add((">=", v));
                tests.Add(("<", new[] { v[0], v[1] + 1, 0 }));
            }
            else
            {
                int n = tok.StartsWith(">=") || tok.StartsWith("<=") ? 2 : tok[0] == '>' || tok[0] == '<' ? 1 : 0;
                tests.Add((n > 0 ? tok[..n] : "=", Parse(tok[n..])));
            }
        }
        return tests;
    }

    public static bool Satisfies(string version, string range)
    {
        var v = Parse(version);
        return Comparators(range).All(t =>
        {
            int c = Cmp(v, t.V);
            return t.Op switch { ">=" => c >= 0, ">" => c > 0, "<=" => c <= 0, "<" => c < 0, _ => c == 0 };
        });
    }
}

public class Registry
{
    public readonly Dictionary<string, Dictionary<string, Meta>> Index = new(); // name -> version -> metadata
    public readonly Dictionary<string, string> Blobs = new();                   // hash -> tarball

    public bool Publish(string name, string version, List<(string, string)> deps)
    {
        string body = $"{name}@{version}|{string.Join(",", deps.Select(d => $"{d.Item1}:{d.Item2}"))}"; // stands in for the tarball bytes
        string integrity = "sha256-" + Semver.Sha(body)[..16];
        if (!Index.ContainsKey(name)) Index[name] = new();
        if (Index[name].TryGetValue(version, out var old)) // a version is immutable: the same bytes are a no-op, different bytes are refused
        {
            if (old.Integrity != integrity) throw new InvalidOperationException($"{name}@{version} already exists with different content");
            return false;
        }
        Index[name][version] = new Meta(deps, integrity, false);
        Blobs[integrity] = body;
        return true;
    }

    public void Yank(string name, string version) => Index[name][version] = Index[name][version] with { Yanked = true }; // hidden from new resolutions, still downloadable

    // Pick the highest allowed version of every package. A lock entry that still fits the range wins, even if it was yanked.
    public Dictionary<string, string> Resolve(List<(string, string)> root, Dictionary<string, string>? lk = null)
    {
        lk ??= new();
        var chosen = new Dictionary<string, string>();
        var queue = new Queue<(string Name, string Range, string From)>(root.Select(r => (r.Item1, r.Item2, "app")));
        while (queue.Count > 0)
        {
            var (name, range, from) = queue.Dequeue();
            if (chosen.TryGetValue(name, out var have))
            {
                if (!Semver.Satisfies(have, range)) throw new InvalidOperationException($"{from} needs {name} {range}, but {name}@{have} is already chosen");
                continue;
            }
            if (!Index.TryGetValue(name, out var versions)) throw new InvalidOperationException($"unknown package {name}");
            string? pick = lk.TryGetValue(name, out var locked) && Semver.Satisfies(locked, range) ? locked : null;
            if (pick == null)
            {
                var ok = versions.Where(kv => !kv.Value.Yanked && Semver.Satisfies(kv.Key, range)).Select(kv => kv.Key).OrderBy(v => v, Comparer<string>.Create((a, b) => Semver.Cmp(Semver.Parse(a), Semver.Parse(b)))).ToList();
                pick = ok.Count > 0 ? ok[^1] : null;
            }
            if (pick == null) throw new InvalidOperationException($"no version of {name} matches {range}");
            chosen[name] = pick;
            foreach (var d in versions[pick].Deps) queue.Enqueue((d.Name, d.Range, $"{name}@{pick}"));
        }
        return chosen;
    }

    // Download each tarball by hash and check that the bytes still hash to the value in the lock.
    public List<string> Install(Dictionary<string, string> chosen)
    {
        var bad = new List<string>();
        foreach (var (name, version) in chosen)
        {
            string integrity = Index[name][version].Integrity;
            if ("sha256-" + Semver.Sha(Blobs[integrity])[..16] != integrity) bad.Add($"{name}@{version}");
        }
        return bad;
    }
}

public static class Program
{
    static string Show(Dictionary<string, string> m) => string.Join(", ", m.OrderBy(kv => kv.Key, StringComparer.Ordinal).Select(kv => $"{kv.Key}@{kv.Value}"));
    static List<(string, string)> D(params (string, string)[] d) => d.ToList();

    public static int Main()
    {
        var reg = new Registry();
        var releases = new (string, string, List<(string, string)>)[]
        {
            ("colorize", "1.0.0", D()), ("colorize", "1.1.0", D()), ("colorize", "1.1.5", D()), ("colorize", "2.0.0", D()),
            ("pathx", "1.0.0", D()), ("pathx", "1.2.0", D()), ("pathx", "1.3.0", D()), ("pathx", "2.0.0", D()),
            ("tinyutil", "0.3.0", D()), ("tinyutil", "0.3.4", D()), ("tinyutil", "0.4.0", D()),
            ("loglite", "1.4.0", D(("colorize", "^1.0.0"))), ("loglite", "1.4.2", D(("colorize", ">=1.1.0 <2.0.0"))), ("loglite", "1.5.0", D(("colorize", "^1.1.0"))),
            ("webkit", "2.1.0", D(("pathx", "^1.2.0"), ("tinyutil", "^0.3.0"))), ("webkit", "2.2.0", D(("pathx", "^1.2.0"), ("tinyutil", "^0.3.1"))),
            ("webkit", "3.0.0", D(("pathx", "^2.0.0"))),
        };
        foreach (var (n, v, d) in releases) reg.Publish(n, v, d);

        var app = D(("webkit", "^2.0.0"), ("loglite", "~1.4.0"), ("pathx", "^1.2.0"));
        var lk = reg.Resolve(app);
        Console.WriteLine($"resolved: {Show(lk)}");
        try { reg.Resolve(D(("webkit", "^3.0.0"), ("pathx", "^1.0.0"))); } catch (InvalidOperationException e) { Console.WriteLine($"conflict: {e.Message}"); }

        reg.Yank("webkit", "2.2.0");
        Console.WriteLine($"after yank, new install: {Show(reg.Resolve(app))}");
        Console.WriteLine($"after yank, locked install: {Show(reg.Resolve(app, lk))}");

        Console.WriteLine($"webkit@2.1.0 integrity {reg.Index["webkit"]["2.1.0"].Integrity}");
        Console.WriteLine($"republish same bytes: {reg.Publish("webkit", "2.1.0", D(("pathx", "^1.2.0"), ("tinyutil", "^0.3.0"))).ToString().ToLowerInvariant()}");
        bool refused = false;
        try { reg.Publish("webkit", "2.1.0", D(("evil", "*"))); } catch (InvalidOperationException e) { refused = true; Console.WriteLine($"republish other bytes: {e.Message}"); }

        int clean = reg.Install(lk).Count;
        reg.Blobs[reg.Index["pathx"]["1.3.0"].Integrity] = "pathx@1.3.0|evil:*"; // someone swaps the stored bytes
        var bad = reg.Install(lk);
        Console.WriteLine($"install before tamper: {clean} bad; after tamper: {string.Join(", ", bad)}");
        return !refused || clean != 0 || bad.Count != 1 || Show(lk) != "colorize@1.1.5, loglite@1.4.2, pathx@1.3.0, tinyutil@0.3.4, webkit@2.2.0" ? 1 : 0;
    }
}
