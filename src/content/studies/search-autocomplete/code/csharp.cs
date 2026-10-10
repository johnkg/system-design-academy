// A trie that stores the best suggestions at every node, in C#:
// answering a prefix is a walk down the letters of the prefix, never a search through everything that starts with it.
using System;
using System.Collections.Generic;
using System.Linq;

public record Entry(string Query, int Count);

public class Node
{
    public Dictionary<char, Node> Children = new();
    public List<Entry> Top = new(); // the K most popular queries that pass through this node
}

public class Trie
{
    const int K = 5; // suggestions kept per node
    readonly Node root = new();

    // Order: more popular first, and alphabetical when equal, so results are the same on every run.
    public static int Better(Entry a, Entry b) => b.Count != a.Count ? b.Count.CompareTo(a.Count) : string.CompareOrdinal(a.Query, b.Query);

    public void Insert(string query, int count)
    {
        var entry = new Entry(query, count);
        var node = root;
        node.Top = KeepBest(node.Top, entry);
        foreach (char ch in query)
        {
            if (!node.Children.ContainsKey(ch)) node.Children[ch] = new Node();
            node = node.Children[ch];
            node.Top = KeepBest(node.Top, entry); // every node on the path remembers this query if it is good enough
        }
    }

    static List<Entry> KeepBest(List<Entry> list, Entry entry)
    {
        var all = new List<Entry>(list) { entry };
        all.Sort(Better);
        return all.Take(K).ToList();
    }

    public List<string> Suggest(string prefix)
    {
        var node = root;
        foreach (char ch in prefix)
        {
            if (!node.Children.TryGetValue(ch, out node)) return new List<string>(); // nothing starts with this prefix
        }
        return node.Top.Select(e => e.Query).ToList();
    }
}

public static class Program
{
    public static int Main()
    {
        var logs = new List<Entry>
        {
            new("car insurance", 9200), new("car rental", 7400), new("cat food", 6100), new("cake recipe", 5200), new("car wash near me", 4800),
            new("cat videos", 4400), new("cars movie", 3900), new("cake pops", 1200), new("carpet cleaning", 1100), new("cabin rentals", 900),
            new("weather today", 12000), new("weather tomorrow", 5000), new("web hosting", 3100), new("wedding dresses", 2800),
        };

        var trie = new Trie();
        foreach (var e in logs) trie.Insert(e.Query, e.Count);

        // Check every prefix against the slow way: scan all queries, filter, sort.
        int mismatches = 0;
        foreach (var prefix in new[] { "c", "ca", "car", "cat", "w", "we", "wea", "x" })
        {
            var fast = trie.Suggest(prefix);
            var slow = logs.Where(e => e.Query.StartsWith(prefix, StringComparison.Ordinal)).OrderBy(e => e, Comparer<Entry>.Create(Trie.Better)).Take(5).Select(e => e.Query).ToList();
            if (!fast.SequenceEqual(slow)) mismatches++;
            Console.WriteLine($"\"{prefix}\" -> {(fast.Count > 0 ? string.Join(" | ", fast) : "(none)")}");
        }
        return mismatches > 0 ? 1 : 0;
    }
}
