// SSRF in a toy model: an image importer that fetches a URL the user typed. There is no real network here:
// a fixed DNS table, a fixed set of redirects and 10 test URLs (3 legitimate, 7 that aim at an internal address).
// What to look for: each check blocks some attacks and is walked around by the next one (a different spelling of the same
// address, a redirect, a DNS answer that changes), and only the last variant leaves nothing reaching the inside.
// Everything is a fixed table, so the output never changes.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

public static class Program
{
    static readonly Dictionary<string, string[]> Dns = new()
    {
        ["images.example.com"] = new[] { "203.0.113.10" },
        ["cdn.example.com"] = new[] { "203.0.113.11" },
        ["partner.example.org"] = new[] { "203.0.113.20" },
        ["evil.example.net"] = new[] { "203.0.113.66" },
        ["rebind.example.net"] = new[] { "203.0.113.50", "10.0.0.5" }, // first answer public, later answers internal (a short-lived record)
        ["internal-admin.corp.test"] = new[] { "10.0.0.5" },
        ["localhost"] = new[] { "127.0.0.1" },
    };
    record Target(string Host, string Path);
    // Pages that answer with a redirect. 169.254.169.254 is the link-local address cloud platforms typically use for instance metadata.
    static readonly Target Meta = new("169.254.169.254", "/latest/meta-data/");
    static readonly Dictionary<string, Target> Redirects = new() { ["evil.example.net/r"] = Meta, ["images.example.com/go"] = Meta };
    record Case(string Id, bool Legit, string Host, string Path, string Note);
    static readonly Case[] Cases =
    {
        new("c1", true, "images.example.com", "/cat.png", "allowed image host"),
        new("c2", true, "cdn.example.com", "/logo.png", "allowed CDN"),
        new("c3", true, "partner.example.org", "/hook", "a real partner, not on the list"),
        new("c4", false, "169.254.169.254", "/latest/meta-data/", "metadata address typed directly"),
        new("c5", false, "localhost", "/admin", "the server's own loopback"),
        new("c6", false, "2130706433", "/admin", "loopback written as one decimal number"),
        new("c7", false, "internal-admin.corp.test", "/users", "a name that resolves to a private address"),
        new("c8", false, "evil.example.net", "/r", "a public page that redirects to metadata"),
        new("c9", false, "images.example.com", "/go", "an open redirect on an allowed host"),
        new("c10", false, "rebind.example.net", "/x", "DNS says public when checked, private when fetched"),
    };
    static readonly string[] Variants = { "no check", "deny-list of strings", "deny-list on resolved IP", "allow-list of hosts", "allow-list + pinned IP + no redirects" };
    static readonly string[] Deny = { "localhost", "127.0.0.1", "169.254.169.254" };
    static readonly string[] BaseAllow = { "images.example.com", "cdn.example.com" };

    static bool IsPrivate(string ip)
    {
        var p = ip.Split('.').Select(int.Parse).ToArray();
        int a = p[0], b = p[1];
        return a == 0 || a == 10 || a == 127 || (a == 169 && b == 254) || (a == 192 && b == 168) || (a == 172 && b >= 16 && b <= 31);
    }

    // Outcome is "served", "blocked" or "LEAK": the server connected to an internal address.
    static (string Outcome, string Ip, List<string> Trace) FetchUrl(int variant, string host, string path, string[] allow)
    {
        var trace = new List<string>();
        var calls = new Dictionary<string, int>();
        string Resolve(string h)
        {
            string ip;
            if (Regex.IsMatch(h, @"^\d+$")) // some URL parsers accept a whole address written as one number
            {
                long n = long.Parse(h);
                ip = string.Join(".", new[] { n / 16777216 % 256, n / 65536 % 256, n / 256 % 256, n % 256 });
            }
            else if (Regex.IsMatch(h, @"^\d+\.\d+\.\d+\.\d+$")) ip = h;
            else
            {
                var answers = Dns[h];
                int i = calls.GetValueOrDefault(h, 0);
                calls[h] = i + 1;
                ip = answers[Math.Min(i, answers.Length - 1)];
            }
            trace.Add($"resolve {h} -> {ip}");
            return ip;
        }
        (string, string, List<string>) Stop(string why) { trace.Add($"blocked: {why}"); return ("blocked", "", trace); }

        if (variant == 1 && Deny.Contains(host)) return Stop("host is on the deny-list");
        if (variant == 2 && IsPrivate(Resolve(host))) return Stop("resolved address is private");
        if (variant >= 3 && !allow.Contains(host)) return Stop("host is not on the allow-list");
        string pinned = "";
        if (variant == 4)
        {
            pinned = Resolve(host);
            if (IsPrivate(pinned)) return Stop("resolved address is private");
        }
        var cur = new Target(host, path);
        for (int hops = 0; hops <= 3; hops++)
        {
            string ip = variant == 4 ? pinned : Resolve(cur.Host);
            trace.Add($"connect {ip}");
            if (IsPrivate(ip)) return ("LEAK", ip, trace);
            if (!Redirects.TryGetValue(cur.Host + cur.Path, out var next)) return ("served", ip, trace);
            if (variant == 4) return Stop("redirects are not followed");
            trace.Add($"redirect to {next.Host}{next.Path}, followed without a new check");
            cur = next;
        }
        return Stop("too many redirects");
    }

    public static void Main()
    {
        foreach (bool partner in new[] { false, true })
        {
            var allow = partner ? BaseAllow.Append("partner.example.org").ToArray() : BaseAllow;
            Console.WriteLine(partner ? "partner.example.org added to the allow-list" : "allow-list is images.example.com and cdn.example.com");
            for (int v = 0; v < Variants.Length; v++)
            {
                var r = Cases.Select(c => (c, res: FetchUrl(v, c.Host, c.Path, allow))).ToList();
                int served = r.Count(x => x.c.Legit && x.res.Outcome == "served");
                int leaks = r.Count(x => !x.c.Legit && x.res.Outcome == "LEAK");
                Console.WriteLine($"  {Variants[v]}: legitimate served {served}/3, attacks reaching an internal address {leaks}/7");
                if (!partner)
                    foreach (var x in r) Console.WriteLine($"    {x.c.Id} {x.res.Outcome}{(x.res.Ip != "" ? " " + x.res.Ip : "")} ({x.c.Note})");
            }
        }
        Console.WriteLine("trace of c9 (open redirect on an allowed host) and c10 (DNS rebinding):");
        foreach (var id in new[] { "c9", "c10" })
        {
            var c = Cases.First(x => x.Id == id);
            foreach (int v in new[] { 2, 3, 4 })
                Console.WriteLine($"  {id} {Variants[v]}: {string.Join("; ", FetchUrl(v, c.Host, c.Path, BaseAllow).Trace)}");
        }
    }
}
