// A toy packet filter and a toy source-NAT table.
// Part 1: a stateless ACL (ordered rules, first match wins, replies need their own rule)
//         against a stateful security group (allow rules only, replies ride the connection table).
// Part 2: source NAT: how a reply finds its way back, and what happens when the port pool runs out.
// Assumptions: IPv4, TCP only. The guarded server listens on 443, 22 and 5432. "Outside" means outside 10.0.0.0/8.
// Real NAT devices typically have about 64,000 ports per public address; the pool here is tiny so the effect is visible.
using System;
using System.Collections.Generic;
using System.Linq;

long Ipv(string s) { long acc = 0; foreach (var o in s.Split('.')) acc = acc * 256 + long.Parse(o); return acc; }
bool InCidr(long addr, string cidr)
{
    var parts = cidr.Split('/');
    long size = 1L << (32 - int.Parse(parts[1]));
    long b = Ipv(parts[0]);
    return addr >= b && addr < b + size;
}
// rule = (action, cidr, firstPort, lastPort); the cidr matches the peer address, the ports match the local port
bool Evaluate(List<(string action, string cidr, int lo, int hi)> rules, string peer, int port)
{
    foreach (var (action, cidr, lo, hi) in rules)
        if (InCidr(Ipv(peer), cidr) && port >= lo && port <= hi) return action == "allow";
    return false; // default deny
}

int[] listening = { 443, 22, 5432 };
const int Ephemeral = 50000; // the client's source port; a reply goes back to it
(string, int)[] attempts =
{
    ("203.0.113.5", 443), ("198.51.100.7", 443), ("203.0.113.5", 22),
    ("10.0.1.9", 5432), ("203.0.113.9", 5432), ("192.0.2.44", 80),
};
const string Any = "0.0.0.0/0";
var returnRule = ("allow", Any, 1024, 65535);
var inbound = () => new List<(string, string, int, int)> { ("allow", Any, 443, 443), ("allow", "10.0.0.0/16", 5432, 5432) };
var configs = new List<(string name, bool stateful, List<(string action, string cidr, int lo, int hi)> inRules, List<(string action, string cidr, int lo, int hi)> outRules)>
{
    ("stateless ACL, inbound rules only", false, inbound(), new()),
    ("stateless ACL, with return rule", false, inbound(), new() { returnRule }),
    ("stateful group, same allow rules", true, inbound(), new()),
    ("ACL, deny /24 listed first", false, new() { ("deny", "203.0.113.0/24", 0, 65535), ("allow", Any, 443, 443), ("allow", "10.0.0.0/16", 5432, 5432) }, new() { returnRule }),
    ("ACL, deny /24 listed second", false, new() { ("allow", Any, 443, 443), ("deny", "203.0.113.0/24", 0, 65535), ("allow", "10.0.0.0/16", 5432, 5432) }, new() { returnRule }),
    ("stateful group, allow all to test", true, new() { ("allow", Any, 0, 65535) }, new()),
};

foreach (var (name, stateful, inRules, outRules) in configs)
{
    int works = 0, reached = 0;
    var exposed = new List<int>();
    foreach (var (client, port) in attempts)
    {
        bool request = Evaluate(inRules, client, port);
        bool reply = stateful ? request : Evaluate(outRules, client, Ephemeral);
        if (request) reached++;
        if (request && reply && listening.Contains(port))
        {
            works++;
            if (!client.StartsWith("10.") && port != 443) exposed.Add(port);
        }
    }
    Console.WriteLine($"{name}: requests that reach the server={reached} connections that work={works} internet-reachable admin ports={(exposed.Count == 0 ? "none" : string.Join(",", exposed))}");
}

// Part 2: source NAT. Each outbound connection gets a public port; the reply is matched against that table.
const string PublicIp = "198.51.100.1";
var entries = new List<(int pub, string priv)>();
foreach (var (priv, port) in new[] { ("10.0.2.10", 40001), ("10.0.2.11", 40001), ("10.0.2.10", 40002) })
{
    int pub = 1024 + entries.Count;
    entries.Add((pub, $"{priv}:{port}"));
    Console.WriteLine($"SNAT {priv}:{port} -> {PublicIp}:{pub}");
}
foreach (int p in new[] { 1025, 9999 })
{
    var row = entries.FirstOrDefault(e => e.pub == p);
    Console.WriteLine(row.priv != null ? $"reply to {PublicIp}:{p} -> {row.priv}" : $"unsolicited packet to {PublicIp}:{p} -> dropped (no table entry)");
}

// Tick model of the port pool: `rate` new connections per tick, each holding its port for `hold` ticks.
string NatRun(int pool, int rate, int hold, int ticks)
{
    var expiring = new int[ticks + hold + 1];
    int used = 0, allocated = 0, dropped = 0, peak = 0;
    for (int t = 0; t < ticks; t++)
    {
        used -= expiring[t];
        int got = Math.Min(rate, pool - used);
        used += got; allocated += got; dropped += rate - got;
        expiring[t + hold] += got;
        peak = Math.Max(peak, used);
    }
    return $"pool={pool} rate={rate}/tick hold={hold} ticks: allocated={allocated} dropped={dropped} peak in use={peak}";
}
Console.WriteLine(NatRun(20, 4, 3, 30));
Console.WriteLine(NatRun(20, 4, 6, 30));
Console.WriteLine(NatRun(40, 4, 6, 30));
