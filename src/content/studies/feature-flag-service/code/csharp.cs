// A feature flag SDK in C#: it evaluates from a cached ruleset with no network call,
// buckets users with a hash of the flag's salt and the user id, and keeps its last ruleset when the service is down.
using System;
using System.Collections.Generic;
using System.Linq;

public record User(string Id, string Plan);
public record Rule(string Attr, string Expected, bool Value);
public record Flag(string Salt, bool Killed, int RolloutBp, Rule[] Rules);
public record Ruleset(int Version, Dictionary<string, Flag> Flags);

public static class Flags
{
    // A 32-bit hash (FNV-1a followed by a final mix) of text, so the same user and flag always give the same number.
    public static uint Hash(string text)
    {
        unchecked
        {
            uint h = 2166136261;
            foreach (char c in text) h = (h ^ c) * 16777619;
            h ^= h >> 16; h *= 2246822507; h ^= h >> 13; h *= 3266489909; h ^= h >> 16;
            return h;
        }
    }
    public static uint Bucket(string salt, string userId) => Hash($"{salt}:{userId}") % 10000; // 0..9999, in hundredths of a percent

    // The order is: kill switch, then targeting rules, then the percentage rollout. A flag that does not exist is off.
    public static bool Evaluate(Ruleset? ruleset, string key, User user)
    {
        if (ruleset == null || !ruleset.Flags.TryGetValue(key, out var flag) || flag.Killed) return false;
        foreach (var rule in flag.Rules) if (rule.Attr == "plan" && user.Plan == rule.Expected) return rule.Value;
        return Bucket(flag.Salt, user.Id) < flag.RolloutBp;
    }
}

public class Sdk
{
    public Ruleset? Current;
    // A poll or a pushed message. A failed fetch (null) and an older version are both ignored, so the last good ruleset stays.
    public void Apply(Ruleset? next) { if (next != null && (Current == null || next.Version > Current.Version)) Current = next; }
    public bool IsOn(string key, User user) => Flags.Evaluate(Current, key, user);
}

public static class Program
{
    static Ruleset Make(int version, int rolloutBp, string salt, bool killed) => new(version, new Dictionary<string, Flag>
    {
        ["new-checkout"] = new Flag(salt, killed, rolloutBp, new[] { new Rule("plan", "internal", true) }),
    });

    public static int Main()
    {
        var users = Enumerable.Range(0, 20000).Select(i => new User($"user-{i}", i % 100 == 0 ? "internal" : "free")).ToList();
        int Count(Sdk s) => users.Count(u => s.IsOn("new-checkout", u));

        var sdk = new Sdk();
        Console.WriteLine($"no ruleset yet, fail closed: {Count(sdk)} users on");
        sdk.Apply(Make(1, 1000, "nc-7f3a", false));
        var at10 = users.Where(u => sdk.IsOn("new-checkout", u)).ToList();
        Console.WriteLine($"10% rollout: {at10.Count} users on");
        sdk.Apply(Make(2, 3000, "nc-7f3a", false));
        var at30 = users.Where(u => sdk.IsOn("new-checkout", u)).ToList();
        int kept = at10.Count(u => sdk.IsOn("new-checkout", u));
        Console.WriteLine($"30% rollout: {at30.Count} users on, {kept} of the first {at10.Count} kept it");

        var resalted = new Sdk(); resalted.Apply(Make(3, 3000, "nc-new-salt", false));
        int lost = at10.Count(u => !resalted.IsOn("new-checkout", u));
        Console.WriteLine($"same 30% with a new salt: {lost} of the first {at10.Count} lose it");

        int other = users.Count(u => Flags.Bucket("other-flag", u.Id) < 3000);
        int both = users.Count(u => Flags.Bucket("other-flag", u.Id) < 3000 && Flags.Bucket("nc-7f3a", u.Id) < 3000);
        Console.WriteLine($"two flags at 30% with different salts: {both} of {other} share users");

        sdk.Apply(null);                              // the service is down: the last ruleset stays
        sdk.Apply(Make(1, 9000, "nc-7f3a", false));   // an old version arrives late: ignored
        Console.WriteLine($"service down, old copy kept: version {sdk.Current!.Version}, {Count(sdk)} users on");
        sdk.Apply(Make(4, 3000, "nc-7f3a", true));
        Console.WriteLine($"kill switch: {Count(sdk)} users on");

        bool monotone = kept == at10.Count && at30.Count > at10.Count;
        bool killed = Count(sdk) == 0;
        return !monotone || !killed || lost == 0 || at10.Count < 1500 ? 1 : 0;
    }
}
