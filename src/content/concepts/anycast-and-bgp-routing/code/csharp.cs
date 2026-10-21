// Simplified BGP best-path selection on a tiny AS graph, with anycast, longest-prefix match and RPKI filtering.
using System;
using System.Collections.Generic;
using System.Linq;

var asn = new Dictionary<string, int> { ["T1"] = 100, ["W"] = 200, ["E"] = 300, ["siteW"] = 64500, ["siteE"] = 64500,
    ["siteT"] = 64500, ["c1"] = 11, ["c2"] = 12, ["c3"] = 13, ["c4"] = 14, ["evil"] = 666 };
// (provider, customer) links and (peer, peer) links; the relation is what the neighbour is to me.
var customerLinks = new[] { ("T1", "W"), ("T1", "E"), ("T1", "siteT"), ("T1", "c4"), ("W", "siteW"), ("E", "siteE"),
    ("W", "c1"), ("E", "c2"), ("W", "c3"), ("E", "c3"), ("W", "evil") };
var peerLinks = new[] { ("W", "E") };
var nodes = asn.Keys.ToList();
var nbrs = nodes.ToDictionary(n => n, n => new List<(string Id, string Rel)>());
foreach (var (p, c) in customerLinks) { nbrs[p].Add((c, "customer")); nbrs[c].Add((p, "provider")); }
foreach (var (a, b) in peerLinks) { nbrs[a].Add((b, "peer")); nbrs[b].Add((a, "peer")); }
var localPref = new Dictionary<string, int> { ["customer"] = 200, ["peer"] = 100, ["provider"] = 50 };
// An origin always prefers its own route.
const int OwnRoutePref = 1000;
const int Ipv4Bits = 32, OctetValues = 256;
// The ROA: 192.0.2.0/23 may only be originated by AS 64500, at most 23 bits long.
const int RoaOriginAsn = 64500, RoaMaxLength = 23;

long IpToInt(string s) => s.Split('.').Aggregate(0L, (a, o) => a * OctetValues + long.Parse(o));
bool Covers(string prefix, string ip) {
    var parts = prefix.Split('/'); long d = 1L << (Ipv4Bits - int.Parse(parts[1]));
    return IpToInt(parts[0]) / d == IpToInt(ip) / d;
}
bool RoaOk(int originAsn, int len) => originAsn == RoaOriginAsn && len <= RoaMaxLength; // ROA: 192.0.2.0/23, origin 64500, maxLength 23

// Higher local-pref, then shorter AS path, then lowest neighbour AS (stand-in for router ID).
bool Better(Route a, Route b) => a.Pref != b.Pref ? a.Pref > b.Pref
    : a.Path.Count != b.Path.Count ? a.Path.Count < b.Path.Count : asn[a.Via!] < asn[b.Via!];

// Propagate one prefix to a fixed point. Customer routes go to everyone, peer/provider routes only to customers.
Dictionary<string, Route> Propagate(List<string> origins, int len, List<string> rovNodes) {
    var best = origins.ToDictionary(o => o, o => new Route(o, new List<int>(), OwnRoutePref, null, true));
    for (bool changed = true; changed;) {
        changed = false;
        foreach (var node in nodes) {
            if (origins.Contains(node)) continue;
            Route? pick = null;
            foreach (var (n, rel) in nbrs[node]) {
                if (!best.TryGetValue(n, out var r)) continue;
                bool fromCustomer = r.Own || nbrs[n].First(x => x.Id == r.Via).Rel == "customer";
                if (!fromCustomer && rel != "provider") continue; // n only exports non-customer routes to its customers
                var path = new List<int> { asn[n] }; path.AddRange(r.Path);
                if (path.Contains(asn[node])) continue; // loop prevention
                if (rovNodes.Contains(node) && !RoaOk(asn[r.Origin], len)) continue; // RPKI: drop invalid origin / too specific
                var cand = new Route(r.Origin, path, localPref[rel], n, false);
                if (pick == null || Better(cand, pick)) pick = cand;
            }
            best.TryGetValue(node, out var old);
            if (pick?.Via != old?.Via || string.Join(",", pick?.Path ?? new()) != string.Join(",", old?.Path ?? new())) {
                if (pick != null) best[node] = pick; else best.Remove(node);
                changed = true;
            }
        }
    }
    return best;
}

// Longest-prefix match: a client uses the most specific prefix it holds a route for.
string Reach(string client, string dst, List<(string Prefix, List<string> Origins)> ann, List<string> rov) {
    foreach (var a in ann.OrderByDescending(x => int.Parse(x.Prefix.Split('/')[1]))) {
        if (!Covers(a.Prefix, dst)) continue;
        if (Propagate(a.Origins, int.Parse(a.Prefix.Split('/')[1]), rov).TryGetValue(client, out var r)) return r.Origin;
    }
    return "none";
}

void Check(bool ok, string msg) { if (!ok) { Console.WriteLine("FAILED: " + msg); Environment.Exit(1); } }

const string Dst = "192.0.2.10";
var clients = new[] { "c1", "c2", "c3", "c4" };
List<(string Prefix, List<string> Origins)> Anycast(params string[] sites) => new() { ("192.0.2.0/23", sites.ToList()) };
Dictionary<string, string> Show(string title, List<(string Prefix, List<string> Origins)> ann, params string[] rov) {
    var o = clients.ToDictionary(c => c, c => Reach(c, Dst, ann, rov.ToList()));
    Console.WriteLine(title + ": " + string.Join(" ", clients.Select(c => $"{c}={o[c]}")));
    return o;
}

var full = Show("3-site anycast", Anycast("siteW", "siteE", "siteT"));
Check(full["c1"] == "siteW" && full["c2"] == "siteE", "customer routes pick the local site");
Check(full["c3"] == "siteW", "tie on pref and length: lowest neighbour AS wins");
Check(full["c4"] == "siteT", "shortest AS path wins");
var down = Show("withdraw siteW", Anycast("siteE", "siteT"));
Check(down["c1"] == "siteE" && down["c3"] == "siteE", "withdrawal re-routes to the next best site");
var hijack = Anycast("siteW", "siteE", "siteT"); hijack.Add(("192.0.2.0/24", new List<string> { "evil" }));
var open = Show("hijack /24, no ROV", hijack);
Check(clients.All(c => open[c] == "evil"), "a more specific /24 beats the /23 everywhere");
var partial = Show("ROV at tier-1 only", hijack, "T1");
Check(partial["c1"] == "evil" && partial["c4"] == "siteT", "filtering only far upstream does not stop the neighbours");
var filtered = Show("ROV at evil ISP", hijack, "W");
Check(clients.All(c => filtered[c] == full[c]), "filtering at the source ISP contains the hijack");
Console.WriteLine("invariants hold");

record Route(string Origin, List<int> Path, int Pref, string? Via, bool Own);
