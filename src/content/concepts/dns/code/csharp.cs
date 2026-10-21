// A caching DNS resolver in C#: the first lookup walks the hierarchy, later ones hit the cache until the TTL ends.
// A fake clock moved by hand keeps the output deterministic.
using System;
using System.Collections.Generic;

public static class Program
{
    static int now; // seconds
    const int Ttl = 300; // seconds a record may be cached

    // What the authoritative server knows
    static readonly Dictionary<string, (string Ip, int Ttl)> Authoritative = new() { ["shop.example.com"] = ("203.0.113.7", Ttl) };

    static readonly Dictionary<string, (string Ip, int ExpiresAt)> Cache = new();

    static (string Ip, string Source) Resolve(string name)
    {
        if (Cache.TryGetValue(name, out var cached) && cached.ExpiresAt > now) return (cached.Ip, "cache");

        // Cache miss: ask the root, then the TLD server, then the authoritative server
        var hops = new[] { "root", ".com", "example.com" };
        var record = Authoritative[name];
        Cache[name] = (record.Ip, now + record.Ttl);
        return (record.Ip, $"network ({string.Join(" -> ", hops)})");
    }

    static void Lookup()
    {
        var (ip, source) = Resolve("shop.example.com");
        Console.WriteLine($"t={now.ToString().PadLeft(3)} s: {ip} from {source}");
    }

    public static void Main()
    {
        Lookup();      // cold: three round trips
        now = 10;
        Lookup();      // within the TTL: cache
        now = Ttl - 1;
        Lookup();      // still within the TTL

        // The operator moves the site to a new server, but caches keep the old answer until the TTL ends
        Authoritative["shop.example.com"] = ("198.51.100.9", Ttl);
        now = Ttl - 1;
        Lookup();      // still the OLD address
        now = Ttl + 1;
        Lookup();      // TTL over: the new address
    }
}
