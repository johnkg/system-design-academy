// Three ideas from Meta's cache consistency posts, as a small model in C# (not Meta's code or data):
// 1. A fill that races an invalidation: a version check ignores older data, but only while the cache still remembers the version.
// 2. An error handler that drops an item only if its version is lower, which does nothing for a stale item that already has the latest version.
// 3. A Polaris-style checker: it re-checks a mismatch and only reports it, and only then asks the database, once it has lasted a whole timescale.
// Time is simulated (seconds), so every run prints the same thing.
using System;
using System.Collections.Generic;
using System.Linq;

public record Entry(int Value, int Version);

// Part 1: the cache holds entries. `Mode` decides how a new value is accepted.
//   none: always overwrite. version: ignore older data while an entry exists. remember: also keep the version of evicted entries.
public class Cache
{
    public string Mode;
    public Dictionary<string, Entry> Entries = new();
    public Dictionary<string, int> Remembered = new();

    public Cache(string mode) { Mode = mode; }

    public void Accept(string key, int value, int version)
    {
        int newest = Entries.TryGetValue(key, out var entry) ? entry.Version : 0;
        if (Mode == "remember") newest = Math.Max(newest, Remembered.GetValueOrDefault(key, 0));
        if (Mode != "none" && newest >= version) return; // older data never overwrites newer data
        Entries[key] = new Entry(value, version);
    }

    public void Evict(string key)
    {
        if (Entries.TryGetValue(key, out var entry) && Mode == "remember") Remembered[key] = entry.Version;
        Entries.Remove(key);
    }
}

public static class Program
{
    static readonly int[] Timescales = { 60, 300 }; // report after one minute and after five minutes

    // Part 2: the cache holds metadata 0 at version 4 but the database holds metadata 1 at version 4.
    static void DropIfLower(Dictionary<string, Entry> entries, string key, int version)
    {
        if (entries.TryGetValue(key, out var entry) && entry.Version < version) entries.Remove(key);
    }

    static void HandleInvalidation(Dictionary<string, Entry> entries, bool error, string handler)
    {
        if (!error) entries["meta"] = new Entry(1, 4); // the normal path writes the new data
        else if (handler == "drop if lower") DropIfLower(entries, "meta", 4);
        else entries.Remove("meta"); // drop whatever the version
    }

    // Part 3: an invalidation says x is 4 at version 4. Three replicas are checked at second 0.
    static int ReplicaHolds(string name, int second)
    {
        if (name == "a") return 4; // up to date
        if (name == "b") return second >= 40 ? 4 : 3; // catches up at second 40
        return 3; // c stays stale
    }

    public static int Main()
    {
        Console.WriteLine("The database holds x=43 at version 2. A fill read x=42 at version 1 earlier, and its reply is late.");
        foreach (var evicted in new[] { false, true })
        {
            foreach (var mode in new[] { "none", "version", "remember" })
            {
                var cache = new Cache(mode);
                cache.Accept("x", 43, 2); // the invalidation arrives first
                if (evicted) cache.Evict("x"); // the entry is evicted before the late reply
                cache.Accept("x", 42, 1); // the old fill reply arrives last
                string result;
                if (!cache.Entries.TryGetValue("x", out var entry)) result = "no entry, the next read refills it from the database (consistent)";
                else if (entry.Value == 43) result = "cache x=43 (consistent)";
                else result = "cache x=42 (stale)";
                Console.WriteLine($"  {(evicted ? "evicted" : "kept   ")}, {mode.PadRight(8)} -> {result}");
            }
        }

        Console.WriteLine("The cache holds metadata=0 at version 4. The database holds metadata=1 at version 4.");
        foreach (var (error, handler) in new[] { (false, "-"), (true, "drop if lower"), (true, "drop always") })
        {
            var entries = new Dictionary<string, Entry> { ["meta"] = new Entry(0, 4) };
            HandleInvalidation(entries, error, handler);
            string result;
            if (!entries.TryGetValue("meta", out var entry)) result = "dropped, the next read refills it from the database";
            else if (entry.Value == 1) result = "consistent";
            else result = "stale for good";
            Console.WriteLine($"  {(error ? "error" : "no error")}, handler {handler.PadRight(13)} -> {result}");
        }

        int withDelay = 0, immediate = 0;
        Console.WriteLine("An invalidation says x=4 at version 4. Replicas are checked at second 0, then again at each timescale.");
        foreach (var name in new[] { "a", "b", "c" })
        {
            if (ReplicaHolds(name, 0) == 4) { Console.WriteLine($"  replica {name}: consistent at second 0"); continue; }
            immediate++; // checking the database at once would cost one query for every mismatch
            var reported = Timescales.Where(t => ReplicaHolds(name, t) != 4).ToList();
            if (reported.Count > 0) withDelay++; // one database check, made when the sample crosses its first timescale
            var text = reported.Count > 0 ? "still wrong after " + string.Join(" and ", reported.Select(t => $"{t / 60} min")) + ", reported" : "fixed itself by second 60, never reported";
            Console.WriteLine($"  replica {name}: wrong at second 0, {text}");
        }
        Console.WriteLine($"database checks that bypass the cache: {withDelay} with the delay, {immediate} if made at once");

        return withDelay >= immediate ? 1 : 0;
    }
}
