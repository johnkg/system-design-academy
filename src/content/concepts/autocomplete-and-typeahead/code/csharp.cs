// Autocomplete: suggest completions of a typed prefix, most popular first. Four ways to answer, compared by how many
// entries each one looks at for one keystroke and how many entries it keeps in memory. Integers only.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    record Q(string Text, int Count);
    record Answer(List<string> Results, int Looked, int Memory);
    class Node { public SortedDictionary<char, Node> Kids = new(); public Q? Query; }

    static readonly Q[] Queries =
    {
        new("ipad", 5200), new("ipad case", 2100), new("ipad pro", 3300), new("iphone", 9800), new("iphone 15", 8700), new("iphone 15 case", 4100),
        new("iphone 15 pro", 3900), new("iphone charger", 2600), new("iphone case", 3000), new("ipod", 600), new("ice maker", 900),
        new("ice cream maker", 1500), new("icon pack", 300), new("ikea desk", 1800), new("ikea shelf", 1100), new("headphones", 7600),
        new("headphones wireless", 3400), new("hdmi cable", 2300), new("hard drive", 2800), new("hair dryer", 4300), new("laptop", 8100),
        new("laptop stand", 2500), new("laptop bag", 2000), new("laptop charger", 3100), new("lamp", 1400), new("keyboard", 6200),
        new("keyboard mechanical", 2900), new("kindle", 3600), new("kitchen scale", 800), new("monitor", 5900), new("monitor arm", 1700),
        new("mouse", 5400), new("mouse pad", 2200), new("microwave", 2400), new("mattress", 3700), new("phone case", 6800),
        new("phone charger", 4600), new("power bank", 3500), new("printer", 4900), new("printer ink", 2700),
    };
    static readonly Q[] Sorted = Queries.OrderBy(q => q.Text, StringComparer.Ordinal).ToArray(); // alphabetical, for the sorted list and for tie-breaks
    const int MaxGram = 20;                                                                          // longest prefix indexed as an edge n-gram
    static readonly Node Root = new();
    static int nodes = 0;

    static List<string> Pick(IEnumerable<Q> items, int k, bool popular)
    {
        var ordered = popular ? items.OrderByDescending(q => q.Count).ThenBy(q => q.Text, StringComparer.Ordinal) : items;
        return ordered.Take(k).Select(q => q.Text).ToList();
    }

    static List<Q> Subtree(Node n, List<Q>? output = null)
    {
        output ??= new List<Q>();
        if (n.Query != null) output.Add(n.Query);
        foreach (var kid in n.Kids.Values) Subtree(kid, output);
        return output;
    }
    static int Size(Node n) => 1 + n.Kids.Values.Sum(Size);

    // Method 1: sorted list. Binary search finds the first entry that could match, then the scan reads every match.
    static Answer SortedList(string prefix, int k, bool popular)
    {
        int lo = 0, hi = Sorted.Length, compares = 0;
        while (lo < hi)
        {
            int mid = (lo + hi) >> 1; compares++;
            if (string.CompareOrdinal(Sorted[mid].Text, prefix) < 0) lo = mid + 1; else hi = mid;
        }
        var found = new List<Q>();
        int looked = compares;
        for (int i = lo; i < Sorted.Length; i++)
        {
            looked++;
            if (!Sorted[i].Text.StartsWith(prefix, StringComparison.Ordinal)) break; // the first non-match ends the scan
            found.Add(Sorted[i]);
            if (!popular && found.Count == k) break;                                  // alphabetical order can stop after k matches
        }
        return new Answer(Pick(found, k, popular), looked, Sorted.Length);
    }

    // Method 2: trie. Walk down the prefix, then visit every node under it to find the completions.
    static Answer Trie(string prefix, int k, bool popular)
    {
        var n = Root; int looked = 0;
        foreach (var ch in prefix)
        {
            if (!n.Kids.TryGetValue(ch, out var next)) return new Answer(new List<string>(), looked, nodes);
            n = next; looked++;
        }
        if (!popular) // depth-first in letter order, stop at k completions
        {
            var found = new List<Q>();
            void Walk(Node m)
            {
                if (found.Count >= k) return;
                looked++;
                if (m.Query != null) found.Add(m.Query);
                foreach (var kid in m.Kids.Values) Walk(kid);
            }
            Walk(n); looked--; // the prefix node was already counted
            return new Answer(found.Select(q => q.Text).ToList(), looked, nodes);
        }
        looked += Size(n) - 1;
        return new Answer(Pick(Subtree(n), k, true), looked, nodes);
    }

    // Method 3: trie with the top k completions stored at every node. Reading the answer is the walk plus k entries.
    static Answer TopK(string prefix, int k, bool popular)
    {
        var n = Root; int looked = 0, stored = 0;
        void Count(Node m) { stored += Math.Min(k, Subtree(m).Count); foreach (var kid in m.Kids.Values) Count(kid); }
        Count(Root);
        foreach (var ch in prefix)
        {
            if (!n.Kids.TryGetValue(ch, out var next)) return new Answer(new List<string>(), looked, nodes + stored);
            n = next; looked++;
        }
        var results = Pick(Subtree(n), k, popular);
        return new Answer(results, looked + results.Count, nodes + stored);
    }

    // Method 4: edge n-grams in a search index. Every query is indexed under each of its prefixes; one term lookup returns a postings list.
    static Answer EdgeNgram(string prefix, int k, bool popular)
    {
        var postings = new Dictionary<string, List<Q>>();
        int total = 0;
        foreach (var q in Sorted)
            for (int len = 1; len <= Math.Min(q.Text.Length, MaxGram); len++)
            {
                var term = q.Text.Substring(0, len);
                if (!postings.ContainsKey(term)) postings[term] = new List<Q>();
                postings[term].Add(q); total++;
            }
        var list = postings.TryGetValue(prefix, out var l) ? l : new List<Q>();
        return new Answer(Pick(list, k, popular), 1 + (popular ? list.Count : Math.Min(k, list.Count)), postings.Count + total);
    }

    // One person types "iphone 15 case". Gaps are the milliseconds between key presses. A request fires after a key if the typist then pauses
    // for at least the debounce time (or it was the last key). The first cacheChars characters are answered from a cache and never reach the backend.
    static readonly int[] Gaps = { 120, 110, 140, 100, 130, 90, 250, 120, 110, 260, 130, 100, 120 };
    const string Text = "iphone 15 case";
    static (int Sent, int Backend) Typing(int debounce, int cacheChars)
    {
        var lengths = new List<int>();
        for (int i = 0; i < Text.Length; i++) if (debounce == 0 || i == Text.Length - 1 || Gaps[i] >= debounce) lengths.Add(i + 1);
        return (lengths.Count, lengths.Count(n => n > cacheChars));
    }

    public static void Main()
    {
        foreach (var q in Sorted)
        {
            var n = Root;
            foreach (var ch in q.Text) { if (!n.Kids.ContainsKey(ch)) { n.Kids[ch] = new Node(); nodes++; } n = n.Kids[ch]; }
            n.Query = q;
        }
        var methods = new (string, Func<string, int, bool, Answer>)[]
        {
            ("sorted list + binary search", SortedList), ("trie", Trie), ("trie with top-k at each node", TopK), ("edge n-grams in an index", EdgeNgram),
        };
        Console.WriteLine($"{Queries.Length} queries, {nodes} trie nodes (distinct prefixes)");
        foreach (var (prefix, k, popular) in new[] { ("ip", 3, true), ("i", 3, true), ("iphone 15", 3, true), ("ip", 3, false) })
        {
            Console.WriteLine($"prefix \"{prefix}\", top {k}, {(popular ? "most popular first" : "alphabetical")}");
            foreach (var (name, fn) in methods)
            {
                var r = fn(prefix, k, popular);
                Console.WriteLine($"  {name}: looked at {r.Looked}, stores {r.Memory}; {string.Join(" | ", r.Results)}");
            }
        }
        Console.WriteLine($"typing \"{Text}\" ({Text.Length} keystrokes)");
        foreach (var (d, c) in new[] { (0, 0), (0, 2), (100, 0), (200, 0), (200, 2) })
        {
            var (sent, backend) = Typing(d, c);
            Console.WriteLine($"  debounce {d} ms, cache first {c} characters: {sent} requests sent, {backend} reach the backend, {backend * 10000} for 10000 people");
        }
        if (!SortedList("ip", 3, true).Results.SequenceEqual(Trie("ip", 3, true).Results) || !TopK("ip", 3, true).Results.SequenceEqual(EdgeNgram("ip", 3, true).Results))
            throw new Exception("methods disagree");
    }
}
