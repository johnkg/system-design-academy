// A feature-flag evaluator: kill switch, targeting rules, then a sticky percentage rollout.
// Hashing is FNV-1a 32-bit with explicit masking, so every language computes the same bucket.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

record Rule(string Attr, string Value, bool Serve);
record Flag(string Key, string Salt, int Percent, bool Killed, Rule[] Rules);
record User(string Id, string Country, string Staff);
record Result(bool On, string Reason);

static class Program
{
    const uint Buckets = 10000, BucketsPerPercent = Buckets / 100;
    const int UserCount = 1000, StaffEvery = 50; // every 50th user is staff
    static readonly string[] Countries = { "US", "DE", "FR", "JP" };
    const int ResaltPercent = 25;
    const int MinSeenAtHalf = 300; // sanity floor for a 50% rollout

    static uint Fnv1a(string text)
    {
        uint hash = 2166136261; // offset basis
        foreach (byte b in Encoding.UTF8.GetBytes(text))
        {
            hash ^= b;
            hash = unchecked(hash * 16777619); // multiply, keep 32 bits
        }
        return hash;
    }

    // Same user + same flag key + same salt => same bucket (0..9999), on every server, forever.
    static uint Bucket(Flag flag, string userId) => Fnv1a($"{flag.Key}:{flag.Salt}:{userId}") % Buckets;

    static string Attr(User u, string name) => name == "staff" ? u.Staff : u.Country;

    static Result Evaluate(Flag flag, User user)
    {
        if (flag.Killed) return new Result(false, "kill switch");
        foreach (var rule in flag.Rules)
            if (Attr(user, rule.Attr) == rule.Value) return new Result(rule.Serve, $"rule {rule.Attr}={rule.Value}");
        bool on = Bucket(flag, user.Id) < flag.Percent * BucketsPerPercent; // percent in whole numbers: 25 -> buckets 0..2499
        return new Result(on, $"rollout {flag.Percent}%");
    }

    // If the flag service cannot be reached, use the last known value, else the safe default compiled into the code.
    static Result EvaluateSafely(Func<Flag> fetchFlag, User user, bool? lastKnown, bool safeDefault = false)
    {
        try { return Evaluate(fetchFlag(), user); }
        catch (Exception)
        {
            return lastKnown is null ? new Result(safeDefault, "service down, safe default") : new Result(lastKnown.Value, "service down, last known");
        }
    }

    static string Show(Result r) => "{\"on\":" + (r.On ? "true" : "false") + ",\"reason\":\"" + r.Reason + "\"}";

    static int Main()
    {
        var users = Enumerable.Range(1, UserCount).Select(i => new User($"user-{i}", Countries[i % Countries.Length], i % StaffEvery == 0 ? "true" : "false")).ToList();
        var flag = new Flag("new-checkout", "v1", 0, false, new[] { new Rule("staff", "true", true), new Rule("country", "DE", false) });
        HashSet<string> Seen(Flag f) => users.Where(u => Evaluate(f, u).On).Select(u => u.Id).ToHashSet();

        Console.WriteLine($"bucket(user-1)={Bucket(flag, "user-1")} bucket(user-2)={Bucket(flag, "user-2")}");
        var previous = new HashSet<string>();
        foreach (int percent in new[] { 0, 10, 25, 50, 100 })
        {
            var now = Seen(flag with { Percent = percent });
            int droppedOut = previous.Count(id => !now.Contains(id)); // stickiness: must stay 0
            Console.WriteLine($"rollout {percent.ToString().PadLeft(3)}%: {now.Count} of {users.Count} see it, {droppedOut} dropped out");
            if (droppedOut != 0) return 1;
            previous = now;
        }

        var salted = Seen(flag with { Percent = ResaltPercent, Salt = "v2" });
        var base25 = Seen(flag with { Percent = ResaltPercent });
        Console.WriteLine($"new salt at 25%: {base25.Count(id => salted.Contains(id))} of {base25.Count} keep the feature (the cohort was reshuffled)");

        int killed = Seen(flag with { Percent = 100, Killed = true }).Count;
        Console.WriteLine($"killed: {killed} see it");
        Func<Flag> down = () => throw new InvalidOperationException("flag service unreachable");
        var dave = users[4]; // user-5, in DE
        Console.WriteLine($"service down, no cache: {Show(EvaluateSafely(down, dave, null))}");
        Console.WriteLine($"service down, cached on: {Show(EvaluateSafely(down, dave, true))}");
        return killed != 0 || Seen(flag with { Percent = 50 }).Count < MinSeenAtHalf ? 1 : 0;
    }
}
