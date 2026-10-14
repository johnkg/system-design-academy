// An anomaly-scoring web application firewall, in C#:
// every rule that matches adds points, a rate rule adds more for a noisy client, and the total is compared with a threshold.
// In detection-only mode the verdict is logged but nothing is blocked.
using System;
using System.Collections.Generic;
using System.Linq;

// Each rule has a part of the request to look at, a text to find, and the points it adds.
var rules = new (string Id, string Part, string Find, int Points)[] {
    ("sqli-union", "url", "union select", 5),
    ("sqli-tautology", "url", "or 1=1", 5),
    ("xss-script", "url", "<script", 5),
    ("path-traversal", "url", "../", 4),
    ("sql-keyword", "url", "select ", 2),
    ("sql-comment", "url", "--", 2),
    ("scanner-agent", "agent", "sqlmap", 5),
    ("script-agent", "agent", "python-requests", 2),
};
const int RateLimit = 3, RatePoints = 3, Window = 50; // more than 3 requests from one client in 50 requests adds 3 points

// Undo the common encodings first, otherwise "%2e%2e%2f" would hide a "../".
string Normalise(string s) => s.ToLowerInvariant().Replace("+", " ").Replace("%27", "'").Replace("%3c", "<").Replace("%2e%2e%2f", "../");

int Score(string url, string agent, int countFromClient) {
    var parts = new Dictionary<string, string> { ["url"] = Normalise(url), ["agent"] = agent.ToLowerInvariant() };
    int total = 0;
    foreach (var rule in rules) if (parts[rule.Part].Contains(rule.Find)) total += rule.Points;
    if (countFromClient > RateLimit) total += RatePoints;
    return total;
}

// A seeded generator, so every run sees the same traffic.
uint seed = 77;
int Rnd(int n) { seed = unchecked(seed * 1664525u + 1013904223u); return (int)((seed >> 16) % (uint)n); }
string Pick(string[] items) => items[Rnd(items.Length)];

string[] normal = { "/search?q=red+shoes", "/cart/add?id=42", "/products?page=3", "/account/orders" };
string[] tricky = { "/help?q=select+a+plan--annual", "/blog?q=how+to+select+a+laptop", "/search?q=a--b+select+size" };
string[] strong = { "/item?id=1+union+select+password+from+users--", "/c?q=%3cscript>alert(1)</script>", "/login?u=x%27+or+1=1" };
string[] evasive = { "/item?id=1;select+sleep(5)", "/f?p=%2e%2e%2fetc/passwd", "/item?id=1+or+1=1" };
const string Browser = "Mozilla/5.0", Bot = "python-requests/2.31";

var traffic = new List<(bool Attack, int Points)>();
var seen = new Dictionary<int, int>(); // requests per client in the current window
for (int i = 0; i < 1000; i++) {
    if (i % Window == 0) seen.Clear();
    int r = Rnd(100);
    bool attack = r >= 80;
    string url, agent; int client;
    if (attack) {
        url = Pick(r < 92 ? strong : evasive);
        agent = Rnd(2) != 0 ? Bot : Browser;
        client = 1 + Rnd(3);
    } else {
        url = Pick(r < 70 ? normal : tricky);
        agent = Browser;
        client = 10 + Rnd(50);
    }
    seen[client] = seen.GetValueOrDefault(client) + 1;
    traffic.Add((attack, Score(url, agent, seen[client])));
}

(int BlockedAttacks, int BlockedUsers, int Missed, int WouldBlock) Run(int threshold, bool detectionOnly) {
    int blockedAttacks = 0, blockedUsers = 0, missed = 0, wouldBlock = 0;
    foreach (var t in traffic) {
        bool flagged = t.Points >= threshold, blocked = flagged && !detectionOnly;
        if (flagged) wouldBlock++;
        if (blocked) { if (t.Attack) blockedAttacks++; else blockedUsers++; }
        if (t.Attack && !blocked) missed++;
    }
    return (blockedAttacks, blockedUsers, missed, wouldBlock);
}

Console.WriteLine($"traffic: {traffic.Count} requests, {traffic.Count(t => t.Attack)} attacks");
foreach (int threshold in new[] { 2, 4, 5, 8 }) {
    var o = Run(threshold, false);
    Console.WriteLine($"threshold {threshold}: blocked attacks {o.BlockedAttacks}, blocked real users {o.BlockedUsers}, attacks let through {o.Missed}");
}
var watch = Run(5, true);
Console.WriteLine($"detection only at 5: would block {watch.WouldBlock}, blocked {watch.BlockedAttacks + watch.BlockedUsers}");

var strict = Run(2, false); var mid = Run(5, false); var loose = Run(8, false);
bool ok = strict.BlockedUsers > mid.BlockedUsers && loose.Missed > mid.Missed && watch.BlockedAttacks + watch.BlockedUsers == 0 && mid.WouldBlock == watch.WouldBlock;
Console.WriteLine($"stricter threshold blocks more real users, looser lets more attacks through: {(ok ? "true" : "false")}");
if (!ok) Environment.Exit(1);
