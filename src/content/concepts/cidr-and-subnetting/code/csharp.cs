// CIDR math with plain integers: parse, describe, split, overlap check and longest-prefix match.
using System;
using System.Collections.Generic;
using System.Linq;

static void Check(bool ok) { if (!ok) { Console.Error.WriteLine("invariant violated"); Environment.Exit(1); } }

static long MaskOf(int p) => p == 0 ? 0 : (long)(0xFFFFFFFFu << (32 - p));
static long ParseIp(string s) => s.Split('.').Aggregate(0L, (acc, o) => acc * 256 + long.Parse(o));
static string FmtIp(long n) => string.Join(".", new[] { 24, 16, 8, 0 }.Select(s => ((n >> s) & 255).ToString()));

static Cidr ParseCidr(string text)
{
    var parts = text.Split('/');
    int prefix = int.Parse(parts[1]);
    long net = ParseIp(parts[0]) & MaskOf(prefix); // clear the host bits
    long size = 1L << (32 - prefix);
    return new Cidr(net, prefix, size, net + size - 1);
}
static string Show(Cidr c) => $"{FmtIp(c.Net)}/{c.Prefix}";

// Cloud VPCs reserve 5 addresses per subnet: network, router, DNS, future use, broadcast.
static string Describe(string text)
{
    var c = ParseCidr(text);
    return $"{Show(c)} addresses={c.Size} usable={c.Size - 5} first={FmtIp(c.Net + 4)} last={FmtIp(c.Last - 1)} mask={FmtIp(MaskOf(c.Prefix))}";
}

// Borrow bits: n subnets need ceil(log2 n) extra prefix bits, giving 2^bits equal slots.
static List<Cidr> Split(Cidr block, int count)
{
    int bits = 0;
    while ((1 << bits) < count) bits++;
    int prefix = block.Prefix + bits;
    long step = 1L << (32 - prefix);
    return Enumerable.Range(0, 1 << bits).Select(i => new Cidr(block.Net + i * step, prefix, step, block.Net + (i + 1) * step - 1)).ToList();
}

static bool Overlaps(Cidr a, Cidr b) => a.Net <= b.Last && b.Net <= a.Last;

// Longest-prefix match: every route whose prefix contains the address matches; the most specific wins.
static string Lookup(List<(string Cidr, string Target)> routes, string ipText)
{
    long ip = ParseIp(ipText);
    (int Prefix, string Target)? best = null;
    foreach (var r in routes)
    {
        var c = ParseCidr(r.Cidr);
        if ((ip & MaskOf(c.Prefix)) == c.Net && (best == null || c.Prefix > best.Value.Prefix)) best = (c.Prefix, r.Target);
    }
    return best == null ? "no route (dropped)" : $"{best.Value.Target} via /{best.Value.Prefix}";
}

foreach (var t in new[] { "10.0.0.0/16", "10.0.3.0/24", "192.168.1.0/28", "172.16.0.0/12" }) Console.WriteLine(Describe(t));
Check(ParseCidr("10.0.0.0/16").Size == 65536);
Check(ParseCidr("10.0.0.77/24").Net == ParseIp("10.0.0.0"));

// Three tiers x three zones = 9 subnets -> 4 bits -> 16 slots of /20, tier by tier.
var slots = Split(ParseCidr("10.20.0.0/16"), 9);
var tiers = new[] { "public", "private", "database" };
for (int i = 0; i < 9; i++) Console.WriteLine($"{tiers[i / 3]}-{"abc"[i % 3]} {Show(slots[i])} usable={slots[i].Size - 5}");
Console.WriteLine($"slots={slots.Count} free={slots.Count - 9}");
var quarters = Split(ParseCidr("192.168.10.0/24"), 4);
Console.WriteLine(string.Join(" ", quarters.Select(Show)));
Check(slots.Count == 16 && slots[0].Size == 4096);
Check(quarters.Count == 4 && quarters.All(q => q.Size == 64));

foreach (var (a, b) in new[] { ("10.20.0.0/16", "10.0.0.0/16"), ("10.0.0.0/16", "10.0.5.0/24"), ("172.20.0.0/16", "172.16.0.0/12"), ("10.0.0.0/16", "10.1.0.0/16") })
    Console.WriteLine($"overlap {a} {b} {Overlaps(ParseCidr(a), ParseCidr(b)).ToString().ToLower()}");
Check(Overlaps(ParseCidr("172.20.0.0/16"), ParseCidr("172.16.0.0/12")));
Check(!Overlaps(ParseCidr("10.20.0.0/16"), ParseCidr("10.0.0.0/16")));

// Order in the table does not matter: the default route is listed first on purpose.
var table = new List<(string Cidr, string Target)> { ("0.0.0.0/0", "nat"), ("10.20.0.0/16", "local"), ("10.0.0.0/16", "vpn"), ("10.20.48.99/32", "quarantine") };
var cases = new[] { ("10.20.48.10", "local via /16"), ("10.0.0.5", "vpn via /16"), ("8.8.8.8", "nat via /0"), ("10.20.48.99", "quarantine via /32") };
foreach (var (ip, want) in cases)
{
    var got = Lookup(table, ip);
    Console.WriteLine($"{ip} -> {got}");
    if (got != want) { Console.Error.WriteLine($"expected {want}"); Environment.Exit(1); }
}
Console.WriteLine($"database table, 8.8.8.8 -> {Lookup(new List<(string Cidr, string Target)> { ("10.20.0.0/16", "local") }, "8.8.8.8")}");

record Cidr(long Net, int Prefix, long Size, long Last);
