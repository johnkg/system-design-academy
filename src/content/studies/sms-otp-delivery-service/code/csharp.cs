// An SMS and one-time-password pipeline, in C#:
// dedupe by key, a pumping guard, cheapest-first routing with failover and circuit breakers, then OTP checks.
using System;
using System.Collections.Generic;
using System.Linq;

uint seed = 7;
int Next() { seed = unchecked(seed * 1664525u + 1013904223u); return (int)(seed >> 16); }
uint Mix(uint x) // a small integer hash (a real service uses HMAC-SHA256 with a secret key)
{
    unchecked
    {
        x = (x ^ (x >> 16)) * 0x45d9f3bu;
        x = (x ^ (x >> 16)) * 0x45d9f3bu;
        return x ^ (x >> 16);
    }
}

// price is in hundredths of a cent per message; good is deliveries per 1000 when healthy
var providers = new[] { ("A", 450, 970), ("B", 600, 985), ("C", 900, 995) }
    .Select(t => new Provider { Name = t.Item1, Price = t.Item2, Good = t.Item3 }).ToList();
int[] mult = { 1, 2, 12 }; // price factor per destination range; range 2 is a premium range that pumping attackers abuse
int failovers = 0; long spend = 0;

bool Attempt(Provider p, int i)
{
    int roll = Next() % 1000;
    bool up = !(p.Name == "A" && i >= 800 && i < 1600); // provider A is down for requests 800 to 1599
    return up && roll < p.Good;
}

// Cheapest first. A provider whose breaker is open is skipped until its cool-down ends, then it gets one trial.
bool Route(int i, int prefix)
{
    foreach (var p in providers)
    {
        if (i < p.Until) continue;
        p.Tries++;
        if (Attempt(p, i)) { p.Fails = 0; p.Ok++; spend += p.Price * mult[prefix]; return true; }
        if (++p.Fails >= 5) { p.Until = i + 200; p.Opens++; } // open the breaker; one more failure re-opens it after a trial
        failovers++;
    }
    return false;
}

int dupes = 0, blocked = 0, delivered = 0, lost = 0; long saved = 0;
var seen = new HashSet<int>();
var sent = new int[3]; var ok = new int[3];
for (int i = 0; i < 3000; i++)
{
    int key = i % 10 == 9 ? i - 1 : i; // every 10th request is a client retry of the one before it
    if (!seen.Add(key)) { dupes++; continue; }
    bool attacker = i >= 1000 && i % 5 == 3;
    int prefix = attacker ? 2 : Next() % 100 < 80 ? 0 : 1;
    if (sent[prefix] >= 30 && ok[prefix] * 10 < sent[prefix]) { blocked++; saved += providers[0].Price * mult[prefix]; continue; } // under 10% verified
    sent[prefix]++;
    if (Route(i, prefix))
    {
        delivered++;
        if (!attacker && Next() % 100 < 85) ok[prefix]++; // a real user types the code in; a pumping bot never does
    }
    else lost++;
}
Console.WriteLine($"requests 3000, duplicate keys ignored {dupes}, blocked by the pumping guard {blocked} (saves {saved})");
foreach (var p in providers) Console.WriteLine($"{p.Name}: {p.Ok} delivered of {p.Tries} tries, breaker opened {p.Opens} times");
Console.WriteLine($"delivered {delivered}, lost {lost}, failovers {failovers}, spend {spend}");
if (delivered + lost + blocked + dupes != 3000) Environment.Exit(1);

// One-time passwords: 6 digits, kept only as a salted hash, valid for 300 s, 5 wrong guesses, then locked.
Otp Issue(int now)
{
    int code = (int)(((long)Next() * 65536 + Next()) % 1000000);
    uint salt = (uint)Next();
    return new Otp { Code = code, Salt = salt, Hash = Mix((uint)code ^ unchecked(salt * 40503u)), Expires = now + 300 };
}
string Verify(Otp r, int guess, int now)
{
    if (r.Used) return "used";
    if (now > r.Expires) return "expired";
    if (r.Tries >= 5) return "locked";
    r.Tries++;
    if (Mix((uint)guess ^ unchecked(r.Salt * 40503u)) != r.Hash) return "wrong";
    r.Used = true;
    return "ok";
}
var a = Issue(0); var b = Issue(0); var c = Issue(0);
var guessing = Enumerable.Range(1, 6).Select(n => Verify(a, n == 6 ? a.Code : (a.Code + n) % 1000000, n));
var results = new[] { string.Join(",", guessing), Verify(b, b.Code, 299) + "," + Verify(b, b.Code, 300), Verify(c, c.Code, 301) };
Console.WriteLine($"six guesses, last one right: {results[0]}");
Console.WriteLine($"right at 299 s then again: {results[1]}; right at 301 s: {results[2]}");
if (results[0] != "wrong,wrong,wrong,wrong,wrong,locked" || results[1] != "ok,used" || results[2] != "expired") Environment.Exit(1);

class Provider { public string Name = ""; public int Price, Good, Fails, Until, Tries, Ok, Opens; }
class Otp { public int Code, Expires, Tries; public uint Salt, Hash; public bool Used; }
