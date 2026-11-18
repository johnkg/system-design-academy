// A new app version (v4) ships on day 0 and users adopt it along a slowing curve, while 8% never update. A server change
// goes live on a chosen day; which of the 1,000,000 active users does it break? Integers only; the seed is fixed.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const long Users = 1000000;
    const long NeverPpm = 80000;                         // 8% of users never update (parts per million)
    static readonly long[] Base = { 100000, 200000, 700000 }; // day 0: users on v1, v2, v3 (v4 is released that day, with no users yet)
    static readonly string[] Names = { "v1", "v2", "v3", "v4" };
    const int StrictParser = 1;                          // v1 rejects a response that has a field it does not know

    static Func<long> MakeRng(long seed)
    {
        long s = seed;
        return () => { s = (s * 48271) % 2147483647; return s; };
    }

    // Each day a share of the users who are willing to update moves to v4. The share slows down: 16% on day 1, one point
    // less each day, never below 1%, plus 0 or 1 point of daily noise. remaining[d] is the part per million of willing users
    // still on an old version.
    static List<long> Adoption(int days)
    {
        var next = MakeRng(5);
        var remaining = new List<long> { 1000000 };
        for (int d = 1; d <= days; d++)
        {
            long pct = Math.Max(1, 16 - d) + (next() % 2);
            remaining.Add(remaining[d - 1] * (100 - pct) / 100);
        }
        return remaining;
    }

    // A share of all users in tenths of a percent, written with integers: 314414 users is "31.4%".
    static string Percent(long users)
    {
        long tenths = users * 1000 / Users;
        return $"{tenths / 10}.{tenths % 10}%";
    }

    // Users on each of the four versions on a given day.
    static long[] Versions(int day)
    {
        long rem = Adoption(day)[day];
        long keep = NeverPpm + (1000000 - NeverPpm) * rem / 1000000; // part per million of each old version still there
        var old = Base.Select(u => u * keep / 1000000).ToArray();
        return old.Append(Users - old.Sum()).ToArray();
    }

    // change: additive (a new field is sent), renamed (a field gets a new name), removed (a field is dropped).
    // The old behaviour is removed on `day`. minVersion: clients below it get a forced-upgrade screen (1 = no minimum).
    // adapt: the server reads the app-version header and keeps sending old clients the shape they know.
    static void Run(string change, int day, int minVersion, bool adapt)
    {
        var users = Versions(day);
        int[] affected = change == "additive" ? new[] { StrictParser } : change == "renamed" ? new[] { 1, 2, 3 } : new[] { 2, 3 }; // versions that read the field
        long forced = users.Where((_, i) => i + 1 < minVersion).Sum();
        long broken = adapt ? 0 : affected.Where(v => v >= minVersion).Sum(v => users[v - 1]);
        string shares = string.Join(", ", users.Select((u, i) => $"{Names[i]} {Percent(u)}"));
        string minimum = minVersion == 1 ? "none" : Names[minVersion - 1];
        Console.WriteLine($"{change} on day {day}, minimum {minimum}, {(adapt ? "adapting to the version header" : "no adaptation")}");
        Console.WriteLine($"  users: {shares}");
        Console.WriteLine($"  broken {broken} of {Users} ({Percent(broken)}); forced to upgrade {forced}");
    }

    public static void Main()
    {
        Run("renamed", 7, 1, false);
        Run("renamed", 14, 1, false);
        Run("renamed", 60, 1, false);
        Run("removed", 30, 1, false);
        Run("additive", 30, 1, false);
        Run("renamed", 30, 3, false);
        Run("renamed", 30, 1, true);
    }
}
