// A miniature of three ideas from Cloudflare's Quicksilver posts, in C# (a teaching model, not Cloudflare's code):
// 1. a numbered log, so a replica can notice a missing entry and ask again from the last entry it applied,
// 2. a replica that keeps older versions of a key, so it can answer "what was the value as of log index N?",
// 3. a proxy that keeps a small window of the newest updates, so it never has to ask a replica that is behind it.
// Everything is deterministic, so every run prints the same thing.
using System;
using System.Collections.Generic;
using System.Linq;

public record Entry(int Index, string Op, string Key, int? Value);
public record Version(int Index, int? Value);

public class Replica
{
    public int Last; // index of the last entry applied
    public Dictionary<string, Version> Current = new(); // a null value is a tombstone (the key was deleted)
    public Dictionary<string, List<Version>> History = new(); // older versions, oldest first

    public bool Apply(Entry e)
    {
        if (e.Index != Last + 1) return false; // a gap (or a repeat): refuse it
        if (Current.TryGetValue(e.Key, out var old))
        {
            if (!History.ContainsKey(e.Key)) History[e.Key] = new List<Version>();
            History[e.Key].Add(old);
        }
        Current[e.Key] = new Version(e.Index, e.Op == "SET" ? e.Value : null);
        Last = e.Index;
        return true;
    }

    // The value of a key as it was when the log was at `index`.
    public int? GetAt(string key, int index)
    {
        if (Current.TryGetValue(key, out var cur) && cur.Index <= index) return cur.Value;
        if (History.TryGetValue(key, out var older))
            for (int i = older.Count - 1; i >= 0; i--) if (older[i].Index <= index) return older[i].Value;
        return null; // the key did not exist yet at that index
    }
}

public static class Program
{
    // The log written at the top of the tree. Indexes go up by exactly one.
    static readonly Entry[] Log =
    {
        new(1, "SET", "a", 1), new(2, "SET", "b", 1), new(3, "SET", "a", 2), new(4, "SET", "c", 1),
        new(5, "DEL", "b", null), new(6, "SET", "d", 1), new(7, "SET", "b", 2), new(8, "SET", "e", 1),
    };
    const int Window = 3; // how many of the newest updates a proxy keeps

    static bool Handshake(string clientDb, string serverDb) => clientDb == serverDb;
    static string Show(int? value) => value is null ? "not found" : value.ToString()!;

    public static int Main()
    {
        // 1. Replication with a numbered log.
        var replica = new Replica();
        foreach (var entry in new[] { Log[0], Log[1], Log[2], Log[4] }) // entry 4 is lost on the way
        {
            if (!replica.Apply(entry))
            {
                Console.WriteLine($"replica at index {replica.Last}: got entry {entry.Index} but expected {replica.Last + 1}, asks again from index {replica.Last}");
                break;
            }
        }
        foreach (var entry in Log.Skip(replica.Last)) replica.Apply(entry);
        Console.WriteLine($"replica resynced and is now at index {replica.Last}");
        Console.WriteLine($"handshake with database page-rules: {(Handshake("dns", "page-rules") ? "accepted" : "refused")}");
        Console.WriteLine($"handshake with database dns: {(Handshake("dns", "dns") ? "accepted" : "refused")}");

        // 2. A proxy at index 5 asks a replica at index 8, which keeps older versions.
        var behind = new Replica(); // what a replica that had stopped at index 5 would answer
        foreach (var entry in Log.Take(5)) behind.Apply(entry);
        bool ok = true;
        foreach (var key in "abcde".Select(c => c.ToString()))
        {
            var answer = replica.GetAt(key, 5);
            ok = ok && answer == behind.GetAt(key, 5);
            Console.WriteLine($"read {key} as of index 5: {Show(answer)} (the replica is at index {replica.Last})");
        }

        // 3. A proxy at index 8 asks a replica that is still at index 5.
        var window = new Dictionary<string, Version>(); // the newest Window updates
        foreach (var e in Log.TakeLast(Window)) window[e.Key] = new Version(e.Index, e.Op == "SET" ? e.Value : null);
        foreach (var key in "abcde".Select(c => c.ToString()))
        {
            int? answer; string source;
            if (window.TryGetValue(key, out var w)) { answer = w.Value; source = "window"; }
            else { answer = behind.GetAt(key, 5); source = "replica at index 5"; }
            ok = ok && answer == replica.GetAt(key, 8);
            Console.WriteLine($"proxy at index 8 reads {key}: {Show(answer)} from the {source}");
        }

        Console.WriteLine($"log entries {Log.Length}, checks {(ok && replica.Last == 8 ? "passed" : "FAILED")}");
        return ok ? 0 : 1;
    }
}
