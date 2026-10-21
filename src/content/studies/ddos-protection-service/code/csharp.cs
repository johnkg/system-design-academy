// An edge shield core, in C#:
// a WAF that adds up rule points (anomaly scoring), and a detector that learns normal traffic and switches on a challenge for unfamiliar clients.
using System;
using System.Linq;

public record Req(string Path, string Ua);

public static class Waf
{
    static readonly (string Needle, int Points)[] Rules = { ("union select", 4), ("<script", 4), ("../", 5), ("' or ", 4), ("--", 1), ("select ", 1) };
    public const int BlockAt = 5;
    const int NoUaPoints = 2;

    // One weak signal is logged, several weak signals together are blocked.
    public static int Score(Req req)
    {
        string text = req.Path.ToLowerInvariant();
        int total = 0;
        foreach (var (needle, points) in Rules) if (text.Contains(needle, StringComparison.Ordinal)) total += points;
        if (req.Ua == "") total += NoUaPoints; // real browsers always send a user agent
        return total;
    }
}

// Learns the normal request rate. While it sees an attack it stops learning, or the attack would become "normal".
public class Baseline
{
    // Starting guess, alert above mean + 4 deviations, exponential smoothing weights, seconds in a row to alert.
    const double InitialMean = 100, InitialDev = 10, AlertDevs = 4, Keep = 0.8, Learn = 0.2;
    const int HotSeconds = 2;
    double mean = InitialMean, dev = InitialDev;
    int hot = 0;
    public bool Observe(double rate)
    {
        if (rate > mean + AlertDevs * dev) hot++;
        else { hot = 0; dev = Keep * dev + Learn * Math.Abs(rate - mean); mean = Keep * mean + Learn * rate; }
        return hot >= HotSeconds; // two seconds in a row above the limit
    }
}

public static class Program
{
    const int Seed = 2024;
    const int Seconds = 60, RealRate = 100, RealJitter = 10;
    const int AttackStart = 20, BotRate = 900, BotJitter = 20, BotIps = 300, BotFingerprints = 3;
    const int RuleDelay = 2; // seconds for the challenge rule to reach the edge
    const int RarePercent = 2, RareFp = 100, RareKinds = 5, CommonFps = 12; // browser fingerprints
    const int RealFailPercent = 10, BotPassPercent = 5; // who fails or passes the challenge
    const double MaxBotPassed = 0.15, MaxRealBlocked = 0.01; // acceptance limits, as fractions
    static long seed = Seed;
    // Linear congruential generator (Numerical Recipes constants), high 16 bits.
    static int Random(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)(seed / 65536 % n); }

    public static int Main()
    {
        var samples = new[] {
            new Req("/search?q=blue shoes", "Mozilla"),
            new Req("/search?q=select a size -- how", "Mozilla"),
            new Req("/item?id=1' or 1=1 --", "Mozilla"),
            new Req("/comment?body=<script>alert(1)</script>", "Mozilla"),
            new Req("/comment?body=<script>alert(1)</script>", ""),
            new Req("/../../etc/passwd", "Mozilla"),
        };
        var scores = samples.Select(Waf.Score).ToArray();
        Console.WriteLine($"waf scores: {string.Join(" ", scores)}; blocked: {string.Join(" ", scores.Select(s => s >= Waf.BlockAt ? "yes" : "no"))}");

        const int IpLimit = 20; // requests per IP per second
        var baseline = new Baseline();
        int detectedAt = -1, challengeFrom = -1;
        int realIn = 0, realBlocked = 0, botIn = 0, botIpLimited = 0, botChallenged = 0, botPassed = 0, botBefore = 0;
        for (int t = 0; t < Seconds; t++)
        {
            int real = RealRate + Random(2 * RealJitter + 1) - RealJitter;
            int bots = t >= AttackStart ? BotRate + Random(2 * BotJitter + 1) - BotJitter : 0; // from second 20, 300 IPs send about 3 requests per second each
            if (detectedAt < 0 && baseline.Observe(real + bots)) { detectedAt = t; challengeFrom = t + RuleDelay; } // the rule takes 2 more seconds to reach the edge
            bool challenge = challengeFrom >= 0 && t >= challengeFrom;
            for (int i = 0; i < real; i++)
            {
                realIn++;
                int fp = Random(100) < RarePercent ? RareFp + Random(RareKinds) : Random(CommonFps); // fingerprints 0 to 11 are common browsers, 100 and up are rare ones
                if (challenge && fp >= RareFp && Random(100) >= 100 - RealFailPercent) realBlocked++; // a few real people fail the challenge
            }
            var perIp = new int[BotIps];
            for (int i = 0; i < bots; i++)
            {
                botIn++;
                int ip = Random(BotIps); Random(BotFingerprints); // the bots use 3 fingerprints, all unknown
                if (++perIp[ip] > IpLimit) { botIpLimited++; continue; }
                if (challenge && Random(100) >= BotPassPercent) { botChallenged++; continue; }
                botPassed++;
                if (!challenge) botBefore++;
            }
        }
        Console.WriteLine($"attack detected at second {detectedAt}, challenge from second {challengeFrom}");
        Console.WriteLine($"bot requests: {botIn}; stopped by the per-IP limit: {botIpLimited}; stopped by the challenge: {botChallenged}; passed: {botPassed} ({botBefore} before the challenge)");
        Console.WriteLine($"real requests: {realIn}; blocked by mistake: {realBlocked}");

        bool ok = string.Join("", scores) == "025465" && detectedAt == 21 && botPassed < botIn * MaxBotPassed && realBlocked < realIn * MaxRealBlocked && botIpLimited == 0;
        return ok ? 0 : 1;
    }
}
