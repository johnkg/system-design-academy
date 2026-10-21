// A developer API platform core: hashed API keys with scopes, plan quotas, version pinning and a breaking-change check.
using System;
using System.Collections.Generic;
using System.Linq;

public class Rec { public string Plan = ""; public string[] Scopes = []; public string Version = ""; public int Used; }
public record Change(string Key, string Verb, bool Breaking);

public static class Platform
{
    // stands in for SHA-256
    public static uint Fnv(string s) { uint h = 0x811c9dc5; foreach (char ch in s) { h ^= ch; h *= 0x01000193; } return h; }

    static readonly Dictionary<string, int> Plans = new() { ["free"] = 5, ["pro"] = 8 }; // calls per month
    const int WarnPct = 80; // warn when this share of the quota is used
    static readonly Dictionary<string, string> Need = new() { ["GET /payments"] = "payments:read", ["POST /payments"] = "payments:write", ["GET /refunds"] = "refunds:read" };
    public static readonly Dictionary<uint, Rec> Store = new(); // hash of the key -> record. The key itself is never stored.

    public static string IssueKey(string name, string plan, string[] scopes, string version)
    {
        string secret = "sk_" + Fnv(name + ":a").ToString("x8") + Fnv(name + ":b").ToString("x8");
        Store[Fnv(secret)] = new Rec { Plan = plan, Scopes = scopes, Version = version };
        return secret; // shown to the developer once
    }

    public static string Handle(string secret, string route)
    {
        if (!Store.TryGetValue(Fnv(secret), out var rec)) return "401 unknown key";
        string need = Need[route];
        if (!rec.Scopes.Contains(need)) return $"403 needs {need}";
        int limit = Plans[rec.Plan];
        if (rec.Used >= limit) return "429 monthly quota used";
        rec.Used++;
        string warn = rec.Used * 100 >= limit * WarnPct ? " (80% of quota used)" : "";
        return $"200 ok, version {rec.Version}{warn}";
    }

    // A spec is a flat map: "METHOD /path req|res name" -> type (requests also say optional or required).
    public static List<Change> Diff(Dictionary<string, string> oldSpec, Dictionary<string, string> newSpec)
    {
        var out_ = new List<Change>();
        foreach (var key in oldSpec.Keys.Union(newSpec.Keys).OrderBy(k => k, StringComparer.Ordinal))
        {
            oldSpec.TryGetValue(key, out var o); newSpec.TryGetValue(key, out var n);
            string kind = key.Split(' ')[2], verb; bool breaking;
            if (o == null) { verb = "added"; breaking = kind == "req" && n!.EndsWith("|required"); }
            else if (n == null) { verb = "removed"; breaking = true; }
            else if (o != n)
            {
                verb = $"changed {o} -> {n}";
                breaking = o.Split('|')[0] != n.Split('|')[0] || (o.EndsWith("|optional") && n.EndsWith("|required"));
            }
            else continue;
            out_.Add(new Change(key, verb, breaking));
        }
        return out_;
    }
}

public static class Program
{
    const int ExtraCalls = 5; // enough calls to exhaust the free quota

    public static int Main()
    {
        var v1 = new Dictionary<string, string> {
            ["GET /payments req limit"] = "int|optional", ["GET /payments res id"] = "string", ["GET /payments res amount"] = "int", ["GET /payments res status"] = "string",
            ["POST /payments req amount"] = "int|required", ["POST /payments req currency"] = "string|required", ["POST /payments res id"] = "string", ["GET /refunds res id"] = "string" };
        var v2 = new Dictionary<string, string> {
            ["GET /payments req limit"] = "int|optional", ["GET /payments req cursor"] = "string|optional", ["GET /payments res id"] = "string", ["GET /payments res amount"] = "string",
            ["GET /payments res created"] = "string", ["POST /payments req amount"] = "int|required", ["POST /payments req currency"] = "string|required",
            ["POST /payments req idempotency_key"] = "string|required", ["POST /payments req note"] = "string|optional", ["POST /payments res id"] = "string" };

        string web = Platform.IssueKey("acme-web", "free", ["payments:read"], "2025-03-01");
        string admin = Platform.IssueKey("acme-admin", "pro", ["payments:read", "payments:write"], "2026-01-15");
        Console.WriteLine($"web key {web[..7]}..., admin key {admin[..7]}...");
        var calls = new List<(string, string)> { (web, "GET /payments"), (web, "POST /payments"), (web, "GET /refunds"), ("sk_bad", "GET /payments"), (admin, "POST /payments") };
        for (int i = 0; i < ExtraCalls; i++) calls.Add((web, "GET /payments"));
        foreach (var (key, route) in calls)
        {
            string who = key == web ? "web  " : key == admin ? "admin" : "other";
            Console.WriteLine($"{who} {route.PadRight(14)} -> {Platform.Handle(key, route)}");
        }

        var changes = Platform.Diff(v1, v2);
        foreach (var c in changes) Console.WriteLine($"{(c.Breaking ? "BREAKING" : "safe    ")} {c.Key}: {c.Verb}");
        int breaking = changes.Count(c => c.Breaking);
        Console.WriteLine($"{breaking} breaking, {changes.Count - breaking} safe: release {(breaking > 0 ? "blocked, ship it as a new version" : "allowed")}");

        // the store holds only hashes of keys, never the keys themselves
        bool plaintext = Platform.Store.Values.Any(r => (r.Plan + string.Join(",", r.Scopes) + r.Version).Contains(web) || (r.Plan + string.Join(",", r.Scopes) + r.Version).Contains(admin));
        if (plaintext || breaking != 4 || changes.Count != 7 || Platform.Handle(web, "GET /payments") != "429 monthly quota used") return 1;
        return 0;
    }
}
