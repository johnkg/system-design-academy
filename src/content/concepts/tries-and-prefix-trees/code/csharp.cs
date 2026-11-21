// Prefix search three ways, counted in character steps (one step = one character compared, or one trie node entered), never in time.
//   scan:   a hash map or list of words has no prefix structure, so every word is checked, character by character
//   sorted: words kept in order, binary search for the first word with the prefix, then read forward
//   trie:   one node per distinct prefix; walk the prefix, then read the subtree below it
// Look for: the trie's cost follows the prefix length and the answer size, not the number of words; its price is nodes.
// A fixed integer generator makes the words, so every language prints the same numbers. Alphabet for the memory model: 26 letters.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    static readonly string[] Syllables = { "ka", "ro", "mi", "te", "su", "no", "la", "pe", "vi", "do", "an", "el", "or", "in", "ta", "ge" };
    const int Alphabet = 26;

    class Node { public SortedDictionary<char, int> Kids = new SortedDictionary<char, int>(); public bool End; }

    static List<string> MakeWords(string kind, int n)
    {
        uint x = 12345;
        Func<uint> next = () => { unchecked { x = x * 1664525 + 1013904223; } return x >> 16; };
        var seen = new HashSet<string>();
        var words = new List<string>();
        while (words.Count < n)
        {
            string w = "";
            if (kind == "words") { uint parts = 2 + (next() % 3); for (uint i = 0; i < parts; i++) w += Syllables[next() % 16]; }
            else for (int i = 0; i < 8; i++) w += (char)(97 + (next() % 26));
            if (seen.Add(w)) words.Add(w);
        }
        return words;
    }

    static (int steps, int found) ScanSearch(List<string> words, string prefix, int limit)
    {
        int steps = 0, found = 0;
        foreach (var w in words)
        {
            int i = 0;
            while (i < prefix.Length) { steps++; if (i >= w.Length || w[i] != prefix[i]) break; i++; }
            if (i == prefix.Length) { found++; if (limit > 0 && found == limit) break; }
        }
        return (steps, found);
    }

    static (int steps, int found) SortedSearch(List<string> sorted, string prefix, int limit)
    {
        int steps = 0;
        Func<string, int> cmp = (w) => // compares the first prefix.Length characters of w with the prefix
        {
            for (int i = 0; i < prefix.Length; i++)
            {
                steps++;
                if (i >= w.Length) return -1;
                if (w[i] != prefix[i]) return w[i] < prefix[i] ? -1 : 1;
            }
            return 0;
        };
        int lo = 0, hi = sorted.Count;
        while (lo < hi) { int mid = (lo + hi) / 2; if (cmp(sorted[mid]) < 0) lo = mid + 1; else hi = mid; }
        int found = 0;
        for (int i = lo; i < sorted.Count && cmp(sorted[i]) == 0; i++) { found++; if (limit > 0 && found == limit) break; }
        return (steps, found);
    }

    static List<Node> BuildTrie(List<string> words)
    {
        var nodes = new List<Node> { new Node() };
        foreach (var w in words)
        {
            int at = 0;
            foreach (char c in w)
            {
                if (!nodes[at].Kids.ContainsKey(c)) { nodes.Add(new Node()); nodes[at].Kids[c] = nodes.Count - 1; }
                at = nodes[at].Kids[c];
            }
            nodes[at].End = true;
        }
        return nodes;
    }

    static (int steps, int found) TrieSearch(List<Node> nodes, string prefix, int limit)
    {
        int steps = 0, found = 0, at = 0;
        foreach (char c in prefix)
        {
            if (!nodes[at].Kids.ContainsKey(c)) return (steps + 1, 0);
            steps++;
            at = nodes[at].Kids[c];
        }
        Func<int, bool> visit = null; // depth-first, letters in order; a node that ends a word is one result
        visit = (id) =>
        {
            if (nodes[id].End) found++;
            if (limit > 0 && found >= limit) return true;
            foreach (var kv in nodes[id].Kids) { steps++; if (visit(kv.Value)) return true; }
            return false;
        };
        visit(at);
        return (steps, found);
    }

    static int CompressedNodes(List<Node> nodes) // a radix tree keeps only the root, word ends and branch points
    {
        int count = 0;
        for (int i = 0; i < nodes.Count; i++) if (i == 0 || nodes[i].End || nodes[i].Kids.Count >= 2) count++;
        return count;
    }

    public static void Main()
    {
        foreach (var kind in new[] { "words", "ids" })
        {
            Console.WriteLine(kind == "words" ? "word-like keys (shared prefixes)" : "random 8-letter ids (little sharing)");
            foreach (int n in new[] { 100, 1000, 10000 })
            {
                var words = MakeWords(kind, n);
                var nodes = BuildTrie(words);
                int chars = words.Sum(w => w.Length);
                Console.WriteLine($"  n={n}: {chars} characters, trie {nodes.Count} nodes, radix tree {CompressedNodes(nodes)} nodes, child slots {nodes.Count * Alphabet} as 26-slot arrays vs {nodes.Count - 1} as maps");
            }
        }

        var all = MakeWords("words", 10000);
        var sorted = new List<string>(all);
        sorted.Sort(string.CompareOrdinal);
        var trie = BuildTrie(all);
        Console.WriteLine("prefix search over 10000 words, typed prefix \"taka\", one letter at a time");
        foreach (int limit in new[] { 0, 10 })
            for (int len = 1; len <= 4; len++)
            {
                string p = "taka".Substring(0, len);
                var a = ScanSearch(all, p, limit); var b = SortedSearch(sorted, p, limit); var c = TrieSearch(trie, p, limit);
                if (limit == 0 && (a.found != b.found || b.found != c.found)) throw new Exception("methods disagree");
                Console.WriteLine($"  {(limit == 0 ? "all matches" : "first " + limit)} for \"{p}\": scan {a.steps} steps, sorted {b.steps}, trie {c.steps} ({c.found} found)");
            }
    }
}
