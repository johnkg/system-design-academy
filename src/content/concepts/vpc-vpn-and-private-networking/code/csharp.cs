// A toy VPC routing evaluator: "can A reach B?" by longest-prefix route lookup, plus the checks that make a route usable.
// Topology: VPC A 10.0.0.0/16 with a public subnet (web, public IP), a private subnet (app) and a database subnet (db).
// A NAT gateway sits in the public subnet. A peer VPC B, an on-premises network 192.168.0.0/16 (over a VPN) and the internet are outside.
// Assumptions: security groups and ACLs allow everything, so only routing is judged; the VPN's far side routes replies back;
// peering needs non-overlapping CIDRs and a route on BOTH sides; an internet gateway only serves hosts with a public IP.
using System;
using System.Collections.Generic;
using System.Linq;

long Ipv(string s) { long acc = 0; foreach (var o in s.Split('.')) acc = acc * 256 + long.Parse(o); return acc; }
(long baseAddr, int bits, long size) Parse(string cidr)
{
    var p = cidr.Split('/');
    int bits = int.Parse(p[1]);
    return (Ipv(p[0]), bits, 1L << (32 - bits));
}
bool Contains(string cidr, string ip) { var c = Parse(cidr); long a = Ipv(ip); return a >= c.baseAddr && a < c.baseAddr + c.size; }
bool Overlaps(string x, string y) { var a = Parse(x); var b = Parse(y); return a.baseAddr < b.baseAddr + b.size && b.baseAddr < a.baseAddr + a.size; }
bool IsPrivate(string ip) => Contains("10.0.0.0/8", ip) || Contains("172.16.0.0/12", ip) || Contains("192.168.0.0/16", ip);

// Longest prefix wins; on a tie the earlier entry (the local route) wins.
string Lookup(List<(string cidr, string target)> table, string ip)
{
    int bestBits = -1; string best = null;
    foreach (var (cidr, target) in table)
    {
        int bits = Parse(cidr).bits;
        if (Contains(cidr, ip) && bits > bestBits) { bestBits = bits; best = target; }
    }
    return best;
}

const string Vpc = "10.0.0.0/16";
var hosts = new Dictionary<string, string> { ["web"] = "10.0.1.10", ["app"] = "10.0.2.10", ["db"] = "10.0.3.10" };

Dictionary<string, List<(string, string)>> BuildTables(Cfg c)
{
    var extra = new List<(string, string)>();
    if (c.Vpn) extra.Add(("192.168.0.0/16", "vpn"));
    if (c.PeerRoute) extra.Add((c.PeerCidr, "peering"));
    var pub = new List<(string, string)> { (Vpc, "local"), ("0.0.0.0/0", "igw") };
    pub.AddRange(extra);
    var priv = new List<(string, string)> { (Vpc, "local") };
    if (c.Nat) priv.Add(("0.0.0.0/0", "nat"));
    priv.AddRange(extra);
    var db = new List<(string, string)> { (Vpc, "local") };
    if (c.DbOpen) db.Add(("0.0.0.0/0", "igw"));
    return new() { ["web"] = pub, ["app"] = priv, ["db"] = db };
}

string Reach(Cfg c, Dictionary<string, List<(string, string)>> tables, string src, string dest)
{
    string target = Lookup(tables[src], dest);
    bool hasPublicIp = src == "web" || (src == "db" && c.DbOpen);
    if (target == null) return "no route";
    if (target == "local") return hosts.Values.Contains(dest) ? "ok (local)" : "no such host here";
    if (target == "igw") return !hasPublicIp ? "no public IP" : IsPrivate(dest) ? "private address dropped" : "ok (internet gateway)";
    if (target == "nat") return IsPrivate(dest) ? "private address dropped" : "ok (NAT gateway)";
    if (target == "peering") return Overlaps(Vpc, c.PeerCidr) ? "peering impossible (overlap)" : !c.PeerBack ? "reply has no route back" : "ok (peering)";
    return "ok (VPN)";
}

void Evaluate(string name, Cfg c)
{
    var tables = BuildTables(c);
    var octets = c.PeerCidr.Split('/')[0].Split('.');
    string peerHost = $"{octets[0]}.{octets[1]}.{octets[2]}.10"; // a host at .10 in the peer VPC's first subnet
    var dests = new[] { ("internet", "8.8.8.8"), ("peer", peerHost), ("onprem", "192.168.5.5"), ("db", hosts["db"]) };
    int ok = 0;
    Console.WriteLine($"{name}:");
    foreach (var src in new[] { "web", "app", "db" })
    {
        var cells = new List<string>();
        foreach (var (label, ip) in dests)
        {
            string r = src == "db" && label == "db" ? "-" : Reach(c, tables, src, ip);
            if (r.StartsWith("ok")) ok++;
            cells.Add($"{label}={r}");
        }
        Console.WriteLine($"  {src} -> {string.Join(", ", cells)}");
    }
    string inWeb = Lookup(tables["web"], "203.0.113.9") == "igw" ? "reachable" : "no path";
    string inDb = c.DbOpen && Lookup(tables["db"], "203.0.113.9") == "igw" ? "reachable" : "no path";
    Console.WriteLine($"  internet -> web: {inWeb}, internet -> db: {inDb}; working paths: {ok}");
}

var baseCfg = new Cfg();
Evaluate("baseline", baseCfg);
Evaluate("no NAT route in the private subnet", baseCfg with { Nat = false });
Evaluate("peering, route on one side only", baseCfg with { PeerRoute = true });
Evaluate("peering, routes on both sides", baseCfg with { PeerRoute = true, PeerBack = true });
Evaluate("peering, overlapping CIDRs", baseCfg with { PeerRoute = true, PeerBack = true, PeerCidr = "10.0.0.0/16" });
Evaluate("VPN route added", baseCfg with { Vpn = true });
Evaluate("database subnet with a default route and public IP", baseCfg with { DbOpen = true });

record Cfg(bool Nat = true, bool Vpn = false, bool PeerRoute = false, bool PeerBack = false, string PeerCidr = "10.1.0.0/16", bool DbOpen = false);
