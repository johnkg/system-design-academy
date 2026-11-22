// A toy tick simulation of three kinds of flood against one service, and seven ways of filtering.
// Every number is a made-up round figure chosen to show the shape of each attack, not a measurement of a real system.
// Legitimate load per tick: 60 home users with their own IP sending 2 requests each, plus one office behind a single NAT IP
// sending 80 requests: 200 in total. Attack intensity varies by 90 to 110 percent per tick from a seeded generator.
// Volumetric: packets that fill the origin's 1,000 unit link. SYN flood: spoofed SYNs that fill a 1,024 entry half-open table
// (each entry lives 5 ticks). HTTP flood: 500 real bot IPs each sending 4 valid requests per tick at an app that handles 600.
// Edge scrubbing: 8 sites of 1,000 units each; it removes 95% of a volumetric flood, proxies SYNs, drops 30% of bot requests by
// reputation, and wrongly drops 2% of legitimate traffic. A challenge is passed by 95% of legitimate users and 10% of bots.
// Assumptions: a blocklist of 10 IPs takes the 10 busiest IPs; spoofed sources are random, so IP-based filters cannot match them.
using System;
using System.Collections.Generic;

const long Ticks = 10, Homes = 60, HomeRate = 2, Office = 80, Legit = Homes * HomeRate + Office;
const long LinkCap = 1000, Volume = 5000, SynRate = 3000, Table = 1024, SynHold = 5;
const long Bots = 500, BotRate = 4, AppCap = 600, Pops = 8, PopCap = 1000, Blocklist = 10;
var limits = new Dictionary<string, long> { ["limit3"] = 3, ["limit1"] = 1 };

// Legitimate requests left after the defence itself has acted ("collateral damage" is Legit minus this).
long LegitAfter(string defense, string stage)
{
    if (defense == "block") return Legit - Office; // the office NAT IP is the busiest IP, so it is blocked first
    if (limits.ContainsKey(defense)) return Homes * Math.Min(HomeRate, limits[defense]) + Math.Min(Office, limits[defense]);
    if (defense == "challenge") return stage == "app" ? Legit * 95 / 100 : Legit;
    if (defense == "edge") return Legit * 98 / 100;
    return Legit;
}

string Sim(string attack, string defense, long scale)
{
    long rngState = 7;
    long Rng() { rngState = (rngState * 48271) % 2147483647; return rngState; }
    var expiring = new long[Ticks + SynHold + 1];
    long used = 0, served = 0, filtered = 0, through = 0;
    for (int t = 0; t < Ticks; t++)
    {
        long m = 90 + (Rng() % 21);
        long legit = LegitAfter(defense, attack == "http" ? "app" : "ip");
        filtered += Legit - legit;
        long l = legit, at = 0;
        if (attack == "volumetric")
        {
            long a = Volume * scale * m / 100;
            if (defense == "edge")
            {
                at = a * 5 / 100;
                long cap = Pops * PopCap;
                if (a + Legit > cap) { l = l * cap / (a + Legit); at = at * cap / (a + Legit); }
            }
            else
            {
                long offered = a + Legit; // the link fills before any filter behind it can act
                long share = offered > LinkCap ? Legit * LinkCap / offered : Legit;
                l = share * legit / Legit;
                at = offered > LinkCap ? a * LinkCap / offered : a;
            }
        }
        else if (attack == "syn")
        {
            long a = SynRate * scale * m / 100;
            if (defense != "edge" && defense != "cookies")
            {
                used -= expiring[t];
                long arrivals = a + legit;
                long admitted = Math.Min(Table - used, arrivals);
                l = admitted * legit / arrivals;
                at = admitted - l; // half-open entries held by spoofed sources
                used += admitted; expiring[t + SynHold] += admitted;
            }
        }
        else
        {
            long n = Bots * scale * m / 100;
            if (defense == "block") at = Math.Max(0, n - (Blocklist - 1)) * BotRate; // 1 slot goes to the office, 9 to bots
            else if (limits.ContainsKey(defense)) at = n * Math.Min(BotRate, limits[defense]);
            else if (defense == "edge") at = n * BotRate * 70 / 100;
            else if (defense == "challenge") at = n * BotRate * 10 / 100;
            else at = n * BotRate;
            long arrivals = at + legit;
            if (arrivals > AppCap) { l = AppCap * legit / arrivals; at = AppCap * at / arrivals; }
        }
        served += l; through += at;
    }
    long Pct(long x) => x * 100 / (Legit * Ticks);
    return $"legit served {Pct(served)}%, dropped by the filter itself {Pct(filtered)}%, attack reaching the service {through / Ticks} per tick";
}

foreach (var attack in new[] { "volumetric", "syn", "http" })
    foreach (var defense in new[] { "none", "block", "limit3", "limit1", "edge", "cookies", "challenge" })
        Console.WriteLine($"{attack} / {defense}: {Sim(attack, defense, 1)}");
Console.WriteLine($"volumetric x2 / none: {Sim("volumetric", "none", 2)}");
Console.WriteLine($"volumetric x2 / edge: {Sim("volumetric", "edge", 2)}");
