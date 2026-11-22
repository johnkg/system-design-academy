// A toy Content Security Policy evaluator. A page requests 11 resources it needs, and an XSS flaw has let an attacker inject 4 more.
// For each policy we decide, resource by resource, what the browser would load or run. A model of the rules, not a browser:
// real CSP has more directives and edge cases. Integers and strings only, so every language prints the same lines.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const string Self = "self";
    // Kind: script | style | img | frame | connect | handler (an inline event handler such as onclick). From: origin or "inline".
    // Nonce: the nonce attribute the element carries. Hash: the hash of its inline text. Trusted: loaded at runtime by an already trusted script.
    record Res(string Id, string Kind, string From, string? Nonce = null, string? Hash = null, bool Injected = false, bool Trusted = false);

    static readonly Res[] Resources =
    {
        new("app.js", "script", Self, "good"),
        new("lib.js (cdn.example)", "script", "cdn.example", "good"),
        new("track.js (analytics.vendor)", "script", "analytics.vendor", "good"),
        new("inline bootstrap script", "script", "inline", "good", "h1"),
        new("inline onclick handler", "handler", "inline"),
        new("site.css", "style", Self),
        new("inline style block", "style", "inline", "good", "h2"),
        new("hero.png (img.cdn)", "img", "img.cdn"),
        new("payment iframe (pay.example)", "frame", "pay.example"),
        new("fetch to api.shop.example", "connect", "api.shop.example"),
        new("chart.js loaded by app.js", "script", "unpkg.example", Trusted: true),
        // Injected through an XSS flaw. The nonce is only used when the attacker has learned the page's nonce.
        new("injected inline script", "script", "inline", Injected: true),
        new("injected img onerror handler", "handler", "inline", Injected: true),
        new("injected script from evil.example", "script", "evil.example", Injected: true),
        new("injected script via cdn.example", "script", "cdn.example", Injected: true), // an allow-listed host that serves attacker-chosen code
    };
    const string ScriptDir = "script-src", Fallback = "default-src";
    static Dictionary<string, string[]> With(params (string, string[])[] extra)
    {
        var d = new Dictionary<string, string[]> { ["img-src"] = new[] { "self", "img.cdn" }, ["frame-src"] = new[] { "pay.example" }, ["connect-src"] = new[] { "self", "api.shop.example" } };
        foreach (var (k, v) in extra) d[k] = v;
        return d;
    }
    static readonly (string Name, Dictionary<string, string[]>? P)[] Policies =
    {
        ("none", null),
        ("allow-list + unsafe-inline", With(("script-src", new[] { "self", "cdn.example", "analytics.vendor", "unsafe-inline" }), ("style-src", new[] { "self", "unsafe-inline" }))),
        ("allow-list only", With(("script-src", new[] { "self", "cdn.example", "analytics.vendor" }), ("style-src", new[] { "self" }))),
        ("hashes + allow-list", With(("script-src", new[] { "self", "cdn.example", "analytics.vendor", "hash:h1" }), ("style-src", new[] { "self", "hash:h2" }))),
        ("nonce + strict-dynamic", With(("script-src", new[] { "nonce:good", "strict-dynamic" }), ("style-src", new[] { "self", "nonce:good" }))),
        ("default-src 'none'", new Dictionary<string, string[]> { ["default-src"] = Array.Empty<string>() }),
    };
    static Dictionary<string, string[]>? Pol(string name) => Policies.First(p => p.Name == name).P;
    static readonly Dictionary<string, string> Directive = new() { ["script"] = ScriptDir, ["handler"] = ScriptDir, ["style"] = "style-src", ["img"] = "img-src", ["frame"] = "frame-src", ["connect"] = "connect-src" };

    static bool Allows(Dictionary<string, string[]>? policy, Res r, bool nonceLeaked)
    {
        if (policy == null) return true;
        if (!policy.TryGetValue(Directive[r.Kind], out var src) && !policy.TryGetValue(Fallback, out src)) return true;
        string? nonce = r.Injected ? (nonceLeaked ? "good" : null) : r.Nonce;
        bool hasNonceOrHash = src.Any(s => s.StartsWith("nonce:") || s.StartsWith("hash:"));
        if (r.From == "inline")
        {
            if (r.Kind == "handler") return src.Contains("unsafe-inline") && !hasNonceOrHash; // nonces and hashes do not cover handler attributes
            if (nonce != null && src.Contains("nonce:" + nonce)) return true;
            if (r.Hash != null && !r.Injected && src.Contains("hash:" + r.Hash)) return true;
            return src.Contains("unsafe-inline") && !hasNonceOrHash; // unsafe-inline is ignored once a nonce or hash is present
        }
        if (src.Contains("strict-dynamic") && r.Kind == "script") return r.Trusted || (nonce != null && src.Contains("nonce:" + nonce)); // host lists are ignored
        if (nonce != null && src.Contains("nonce:" + nonce)) return true;
        return src.Contains(r.From == Self ? "self" : r.From);
    }

    record Outcome(int Legit, int Ran, int Violations, List<string> Broken, List<string> RanInjected);
    static Outcome Evaluate(Dictionary<string, string[]>? policy, bool reportOnly, bool nonceLeaked)
    {
        int legit = 0, ran = 0, violations = 0; var broken = new List<string>(); var ranInjected = new List<string>();
        foreach (var r in Resources)
        {
            bool ok = Allows(policy, r, nonceLeaked);
            if (!ok) violations++;
            bool loads = ok || reportOnly; // report-only logs the violation but changes nothing
            if (r.Injected) { if (loads && r.Kind != "img") { ran++; ranInjected.Add(r.Id); } }
            else if (loads) legit++; else broken.Add(r.Id);
        }
        return new Outcome(legit, ran, violations, broken, ranInjected);
    }
    static string Line(string name, Outcome o) => $"{name}: legit resources loaded {o.Legit} of 11; injected scripts that run {o.Ran} of 4; violations reported {o.Violations}";

    static readonly (string What, string Key, string Name)[] Attacks =
    {
        ("first visit over http, attacker strips the redirect to https", "hsts", "HSTS (after a first visit)"),
        ("evil.example frames the page to trick clicks", "frame-ancestors", "frame-ancestors"),
        ("an uploaded .txt is sniffed and run as script", "nosniff", "X-Content-Type-Options: nosniff"),
        ("evil.example posts a form to the shop with the session cookie", "samesite", "SameSite=Lax cookie"),
    };
    static string Headers(string[] set) => $"headers [{(set.Length == 0 ? "none" : string.Join(", ", set))}]: stops {Attacks.Count(a => set.Contains(a.Key))} of 4 attacks";

    public static void Main()
    {
        Console.WriteLine("-- enforcing, nonce not leaked");
        foreach (var (name, p) in Policies) Console.WriteLine("  " + Line(name, Evaluate(p, false, false)));
        Console.WriteLine("-- what an injected script still runs under each policy");
        foreach (var (name, p) in Policies) { var o = Evaluate(p, false, false); Console.WriteLine($"  {name}: {(o.RanInjected.Count == 0 ? "none" : string.Join(", ", o.RanInjected))}"); }
        Console.WriteLine("-- what breaks for legitimate resources");
        foreach (var name in new[] { "allow-list only", "hashes + allow-list", "nonce + strict-dynamic" })
        {
            var b = Evaluate(Pol(name), false, false).Broken;
            Console.WriteLine($"  {name}: {(b.Count == 0 ? "nothing" : string.Join(", ", b))}");
        }
        Console.WriteLine("-- break it: the same nonce on every response, so the attacker copies it");
        Console.WriteLine("  " + Line("nonce + strict-dynamic, static nonce", Evaluate(Pol("nonce + strict-dynamic"), false, true)));
        Console.WriteLine("-- report-only rollout: nothing blocked, violations collected first");
        Console.WriteLine("  " + Line("allow-list only, report-only", Evaluate(Pol("allow-list only"), true, false)));
        Console.WriteLine("  " + Line("default-src 'none', report-only", Evaluate(Pol("default-src 'none'"), true, false)));
        Console.WriteLine("-- other headers");
        Console.WriteLine("  " + Headers(new string[0]));
        Console.WriteLine("  " + Headers(new[] { "frame-ancestors" }));
        Console.WriteLine("  " + Headers(new[] { "hsts", "frame-ancestors", "nosniff", "samesite" }));
        foreach (var (what, key, name) in Attacks)
            Console.WriteLine($"  with only frame-ancestors and SameSite: {what}: {(key == "frame-ancestors" || key == "samesite" ? "stopped by " + name : "still works")}");
    }
}
