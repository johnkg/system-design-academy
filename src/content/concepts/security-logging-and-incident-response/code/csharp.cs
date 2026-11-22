// Security logging in a toy model: redaction, a hash-chained log, and detection rules over one seeded day of login events.
// Seeded generator (Park-Miller), integers only. WARNING: the hash used for the chain is a 32-bit FNV-1a STAND-IN, not secure;
// a real log chain uses a cryptographic hash or an HMAC, and keeps its head hash somewhere the attacker cannot write.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    static string Hex(uint h) => h.ToString("x8");
    static uint Fnv(string s) { uint h = 2166136261u; foreach (char c in s) { h ^= c; h = unchecked(h * 16777619u); } return h; }

    static readonly string[] Sensitive = { "password", "token", "card" };
    static string Redact(string line) => string.Join(" ", line.Split(' ').Select(kv =>
    {
        if (!kv.Contains('=')) return kv;
        var parts = kv.Split('=');
        string k = parts[0], v = parts[1];
        if (!Sensitive.Contains(k)) return kv;
        return k == "card" ? $"{k}=****{v.Substring(v.Length - 4)}" : $"{k}=[redacted]";
    }));

    static List<uint> Chain(IEnumerable<string> lines)
    {
        uint prev = 0; var o = new List<uint>();
        foreach (var l in lines) { prev = Fnv(Hex(prev) + "|" + l); o.Add(prev); }
        return o;
    }
    static string Verify(List<string> lines, List<uint> stored, uint? anchor)
    {
        var now = Chain(lines);
        for (int i = 0; i < stored.Count; i++) if (i >= now.Count || now[i] != stored[i]) return $"broken at entry {i + 1}";
        if (lines.Count != stored.Count) return "chain consistent, but length differs from the stored hashes";
        if (anchor == null) return "chain consistent, nothing outside to compare the head with";
        return now[^1] == anchor ? "intact, head matches the anchor" : "chain consistent, but the head does not match the anchor: tampering detected";
    }

    static long seed = 12345;
    static int Rnd(int n) { seed = seed * 48271 % 2147483647; return (int)(seed % n); }

    const int Day = 1440, Normal = 20, Office = 20, A = 21, B = 22, Src = 23, Triage = 10, Cooldown = 60;
    static readonly int[] Users = Enumerable.Range(0, Src).Select(i => i == Office ? 40 : 1).ToArray();
    static readonly int[][] Fails = Enumerable.Range(0, Src).Select(_ => new int[Day]).ToArray();
    static readonly int[][] Wins = Enumerable.Range(0, Src).Select(_ => new int[Day]).ToArray();
    static readonly Dictionary<int, (int Start, int Breach)> Attack = new() { [A] = (800, 810), [B] = (200, 500) };

    static int Total(int[] arr, int from, int to) { int t = 0; for (int i = Math.Max(0, from); i <= to; i++) t += arr[i]; return t; }

    class Alert { public int T, S, Done; }

    static (int N, int False, int MaxWait, int Blocked, Dictionary<int, string> Who) Detect(int window, int threshold, bool correlate, string response)
    {
        var alerts = new List<Alert>(); var last = Enumerable.Repeat(-1000, Src).ToArray();
        for (int m = 0; m < Day; m++) for (int s = 0; s < Src; s++)
        {
            if (m - last[s] < Cooldown) continue;
            bool hit = false;
            if (Total(Fails[s], m - window + 1, m) >= threshold) hit = true;
            else if (correlate && Wins[s][m] == 1 && Total(Fails[s], m - 15, m - 1) >= 3) hit = true;
            if (hit) { alerts.Add(new Alert { T = m, S = s }); last[s] = m; }
        }
        // One on-call engineer, first come first served, 10 minutes per alert.
        int free = 0, maxWait = 0, blocked = 0; var seenBlocked = new HashSet<int>();
        var first = new Dictionary<int, Alert?> { [A] = null, [B] = null };
        foreach (var a in alerts)
        {
            int start = Math.Max(a.T, free); free = start + Triage; maxWait = Math.Max(maxWait, start - a.T);
            a.Done = free;
            bool real = a.S == A || a.S == B;
            if (!real && response == "auto" && seenBlocked.Add(a.S)) blocked += Users[a.S];
            if (real && first[a.S] == null) first[a.S] = a;
        }
        int falseAlerts = alerts.Count(a => a.S != A && a.S != B);
        var who = new Dictionary<int, string>();
        foreach (var s in new[] { A, B })
        {
            var a = first[s];
            if (a == null) { who[s] = "never detected"; continue; }
            int contained = response == "auto" ? a.T + 1 : a.Done + (response == "runbook" ? 2 : 15);
            int ttd = a.T - Attack[s].Start, ttc = contained - Attack[s].Start;
            string tail = contained < Attack[s].Breach ? "stopped before the login succeeded" : $"attacker had access for {contained - Attack[s].Breach} min";
            who[s] = $"detected {ttd} min after it began, contained {ttc} min after; {tail}";
        }
        return (alerts.Count, falseAlerts, maxWait, blocked, who);
    }

    static void Show(string label, int w, int t, bool correlate, string response)
    {
        var r = Detect(w, t, correlate, response);
        Console.WriteLine($"  {label}: alerts {r.N}, of which false {r.False}; longest wait for a look {r.MaxWait} min; legit users locked out {r.Blocked}");
        Console.WriteLine($"    fast attacker: {r.Who[A]}");
        Console.WriteLine($"    slow attacker: {r.Who[B]}");
    }

    public static void Main()
    {
        Console.WriteLine("-- 1. what never goes in a log: secrets are redacted before the line is written");
        const string raw = "login_failed user=alice ip=203.0.113.7 password=hunter2 token=abc123 card=4111111111111111 reason=bad_password";
        Console.WriteLine($"  raw:      {raw}");
        Console.WriteLine($"  redacted: {Redact(raw)}");

        Console.WriteLine("-- 2. tamper evidence: each entry commits to the one before it");
        var lines = new List<string> { "login ok user=alice", "role_change user=bob role=admin by=alice", "export_report user=bob rows=50000", "login ok user=carol", "delete_user user=dave by=bob" };
        var stored = Chain(lines); uint anchor = stored[^1];
        Console.WriteLine($"  head hash {Hex(anchor)}, copy kept in a separate write-once store");
        var edited = new List<string>(lines); edited[1] = "role_change user=bob role=viewer by=alice";
        var first3 = lines.Take(3).ToList();
        Console.WriteLine($"  untouched: {Verify(lines, stored, anchor)}");
        Console.WriteLine($"  entry 2 edited: {Verify(edited, stored, anchor)}");
        Console.WriteLine($"  entry 2 edited and every later hash recomputed, anchor kept elsewhere: {Verify(edited, Chain(edited), anchor)}");
        Console.WriteLine($"  entry 2 edited and every later hash recomputed, no anchor: {Verify(edited, Chain(edited), null)}");
        Console.WriteLine($"  last 2 entries deleted, hashes truncated to match: {Verify(first3, Chain(first3), anchor)}");

        Console.WriteLine("-- 3. detection: failed logins over one day (1,440 minutes), 23 sources");
        // Sources 0..19 ordinary users (1 person each), 20 the office NAT (40 people), 21 attacker A (fast), 22 attacker B (slow and spread out).
        for (int m = 0; m < Day; m++) for (int s = 0; s < Src; s++)
        {
            if (s < Normal)
            {
                if (Rnd(1000) < 6)
                {
                    Fails[s][m] += 1 + (Rnd(100) < 25 ? 1 + Rnd(3) : 0); // a mistyped password, then a correct one
                    if (m + 1 < Day) Wins[s][m + 1] = 1;
                }
            }
            else if (s == Office)
            {
                if (Rnd(100) < 5) Fails[s][m] += 1;
                if (m >= 540 && m < 550) Fails[s][m] += 3; // a password rotation notice lands at 09:00: 40 people retype
                Wins[s][m] = 1;                            // somebody in the office logs in every minute
            }
            else if (s == A && m >= 800 && m < 810) Fails[s][m] = 8;
            else if (s == B && m >= 200 && m < 500) Fails[s][m] = 1;
        }
        Wins[A][810] = 1; Wins[B][500] = 1; // the attackers get in
        Show("5 min window, 3 failures, manual", 5, 3, false, "manual");
        Show("5 min window, 10 failures, manual", 5, 10, false, "manual");
        Show("5 min window, 20 failures, manual", 5, 20, false, "manual");
        Show("60 min window, 40 failures, manual", 60, 40, false, "manual");
        Show("60 min window, 40 failures, runbook", 60, 40, false, "runbook");
        Show("5 min window, 10 failures, auto-block", 5, 10, false, "auto");
        Show("5 min window, 20 failures plus success-after-failures rule, manual", 5, 20, true, "manual");
    }
}
