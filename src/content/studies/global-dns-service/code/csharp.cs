// An authoritative DNS answerer in C#:
// zone data with failover and weighted policies, health checks, a resolver cache that shows how TTL controls failover time,
// and response rate limiting (RRL) against a spoofed amplification attack.
using System;
using System.Collections.Generic;
using System.Linq;

const int DefaultTtl = 300, CdnTtl = 60, Clients = 10000;
const int CheckInterval = 10, FailThreshold = 3; // health checks every 10 s, 3 failures in a row mark the address down
const int RrlLimit = 5; // full answers per second per (client prefix, name)
const int AttackSeconds = 3, AttackQps = 1000, LegitQps = 2;
const int AnswerBytes = 1400, SlipBytes = 90, QueryBytes = 70; // a signed answer, a truncated reply, a spoofed query
const int MinReduction = 20; // RRL must cut the reflected bytes at least 20-fold
const int NegTtl = 60; // how long resolvers may cache "no such name" (the SOA minimum)
const string Primary = "192.0.2.10";
var zone = new Dictionary<string, Rec> {
    ["www.example.com"] = new("failover", new[] { Primary, "198.51.100.20" }, new[] { 1, 1 }),
    ["cdn.example.com"] = new("weighted", new[] { "203.0.113.1", "203.0.113.2", "203.0.113.3" }, new[] { 70, 20, 10 }),
    ["mail.example.com"] = new("static", new[] { "192.0.2.50" }, new[] { 1 }),
};

uint Fnv(string s) { uint h = 0x811c9dc5; foreach (char c in s) h = unchecked((h ^ c) * 16777619u); return h; } // 32-bit FNV-1a hash

// Answer one query from memory. `down` holds the addresses the health checkers marked unhealthy.
(string Rcode, List<string> Ips, int Ttl) Resolve(string name, string client, HashSet<string> down, int ttl) {
    if (!zone.TryGetValue(name, out var rec)) return ("NXDOMAIN", new List<string>(), NegTtl);
    var alive = Enumerable.Range(0, rec.Ips.Length).Where(i => !down.Contains(rec.Ips[i])).ToList();
    if (alive.Count == 0) alive = Enumerable.Range(0, rec.Ips.Length).ToList(); // everything looks down: fail open and answer anyway
    var chosen = alive;
    if (rec.Kind == "failover") chosen = new List<int> { alive[0] };            // the first healthy address in priority order
    if (rec.Kind == "weighted") {                                              // the same client always gets the same pick, so answers are stable
        int total = alive.Sum(i => rec.Weights[i]);
        long r = Fnv($"{name}|{client}") % total;
        foreach (int i in alive) { r -= rec.Weights[i]; if (r < 0) { chosen = new List<int> { i }; break; } }
    }
    return ("NOERROR", chosen.Select(i => rec.Ips[i]).ToList(), ttl);
}

// One resolver asks for www once a second. A failure starts at t=100 and health checks run every `interval` seconds.
(int MarkedAt, int Bad, int Fetches) Failover(int ttl, int interval, int threshold) {
    const int failAt = 100, propagation = 5, end = 4000;
    var down = new HashSet<string>();
    int consecutive = 0, markedAt = -1, bad = 0, fetches = 0;
    string cacheIp = ""; int expires = -1;
    for (int t = 0; t < end; t++) {
        if (t % interval == 0) {
            consecutive = t >= failAt ? consecutive + 1 : 0;
            if (consecutive == threshold) markedAt = t;
        }
        if (markedAt >= 0 && t == markedAt + propagation) down.Add(Primary); // the change reaches every name server a few seconds later
        if (expires < 0 || t >= expires) {
            var a = Resolve("www.example.com", "r1", down, ttl);
            cacheIp = a.Ips[0]; expires = t + a.Ttl; fetches++;
        }
        if (t >= failAt && cacheIp == Primary) bad++;
    }
    return (markedAt, bad, fetches);
}

// Response rate limiting: at most `limit` full answers per second for each (client prefix, name).
// Of the excess, every second one becomes a tiny truncated reply (a real client retries over TCP), the others are dropped.
(Dictionary<string, int> Victim, Dictionary<string, int> Legit, int Bytes, string Amp) Attack(bool rrl) {
    var seen = new Dictionary<string, int>();
    string Check(string prefix, string name, int sec) {
        if (!rrl) return "answer";
        string key = $"{prefix}|{name}|{sec}";
        int n = seen.GetValueOrDefault(key) + 1;
        seen[key] = n;
        if (n <= RrlLimit) return "answer";
        return (n - RrlLimit) % 2 == 0 ? "slip" : "drop";
    }
    var victim = new Dictionary<string, int> { ["answer"] = 0, ["slip"] = 0, ["drop"] = 0 };
    var legit = new Dictionary<string, int> { ["answer"] = 0, ["slip"] = 0, ["drop"] = 0 };
    for (int sec = 0; sec < AttackSeconds; sec++) {
        for (int i = 0; i < AttackQps; i++) victim[Check("198.51.100.0/24", "www.example.com", sec)]++; // spoofed source = the victim
        for (int i = 0; i < LegitQps; i++) legit[Check("203.0.113.0/24", "www.example.com", sec)]++;
    }
    int bytes = victim["answer"] * AnswerBytes + victim["slip"] * SlipBytes;
    return (victim, legit, bytes, (bytes / (double)(AttackSeconds * AttackQps * QueryBytes)).ToString("F2", System.Globalization.CultureInfo.InvariantCulture)); // bytes out per byte the attacker sent
}

var none = new HashSet<string>();
foreach (var name in new[] { "www.example.com", "mail.example.com", "nope.example.com" }) {
    var a = Resolve(name, "r1", none, DefaultTtl);
    Console.WriteLine($"{name} -> {a.Rcode} {string.Join(",", a.Ips)} ttl {a.Ttl}");
}
Console.WriteLine($"www with the primary down -> {string.Join(",", Resolve("www.example.com", "r1", new HashSet<string> { Primary }, DefaultTtl).Ips)}");
Console.WriteLine($"everything down fails open -> {string.Join(",", Resolve("www.example.com", "r1", new HashSet<string>(zone["www.example.com"].Ips), DefaultTtl).Ips)}");

// how 10,000 different clients are spread over the three addresses
SortedDictionary<string, int> Count(HashSet<string> down) {
    var c = new SortedDictionary<string, int>(StringComparer.Ordinal);
    for (int i = 0; i < Clients; i++) { var ip = Resolve("cdn.example.com", $"c{i}", down, CdnTtl).Ips[0]; c[ip] = c.GetValueOrDefault(ip) + 1; }
    return c;
}
string Show(SortedDictionary<string, int> c) => string.Join(" ", c.Select(kv => $"{kv.Key}={kv.Value}"));
var split = Count(none); var split2 = Count(new HashSet<string> { "203.0.113.1" });
Console.WriteLine($"weighted 70/20/10: {Show(split)}");
Console.WriteLine($"weighted, first one down: {Show(split2)}");

var results = new Dictionary<int, (int MarkedAt, int Bad, int Fetches)>();
foreach (int ttl in new[] { 30, 60, 300, 3600 }) {
    var r = Failover(ttl, CheckInterval, FailThreshold); results[ttl] = r;
    Console.WriteLine($"ttl {ttl}: marked down at {r.MarkedAt}, users on the dead address for {r.Bad} s, {r.Fetches} queries to the name server");
}
var off = Attack(false); var on = Attack(true);
foreach (var (label, r) in new[] { ("off", off), ("on", on) })
    Console.WriteLine($"RRL {label}: victim gets {r.Victim["answer"]} answers, {r.Victim["slip"]} truncated, {r.Victim["drop"]} dropped = {r.Bytes} bytes ({r.Amp}x); real resolver answered {r.Legit["answer"]}/6");

bool ok = results[30].MarkedAt == 120 && results[30].Bad == 50 && results[60].Bad == 80 && results[300].Bad == 200 && results[3600].Bad == 3500
    && Math.Abs(split["203.0.113.1"] - 7000) < 400 && Math.Abs(split["203.0.113.2"] - 2000) < 300 && Math.Abs(split["203.0.113.3"] - 1000) < 250 && !split2.ContainsKey("203.0.113.1")
    && off.Victim["answer"] == 3000 && on.Victim["answer"] == 15 && on.Victim["slip"] + on.Victim["drop"] == 2985 && on.Legit["answer"] == 6 && on.Bytes * MinReduction < off.Bytes;
if (!ok) Environment.Exit(1);

record Rec(string Kind, string[] Ips, int[] Weights);
