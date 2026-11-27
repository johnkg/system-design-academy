// Byte-pair encoding in C#: learn merges from a tiny corpus, then encode new words.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    private const int Merges = 8;

    private static List<string> ApplyMerge(List<string> symbols, string a, string b)
    {
        var output = new List<string>();
        for (var i = 0; i < symbols.Count; i++)
        {
            if (i < symbols.Count - 1 && symbols[i] == a && symbols[i + 1] == b)
            {
                output.Add(a + b);
                i++;
            }
            else
            {
                output.Add(symbols[i]);
            }
        }
        return output;
    }

    public static void Main()
    {
        var corpus = new (string Word, int Freq)[] { ("low", 5), ("lower", 2), ("newest", 6), ("widest", 3) };
        var words = corpus.Select(c => (Symbols: c.Word.Select(ch => ch.ToString()).Append("_").ToList(), c.Freq)).ToList(); // "_" marks the end of a word
        var characters = words.SelectMany(w => w.Symbols).ToHashSet();
        var merges = new List<(string A, string B)>();

        for (var n = 1; n <= Merges; n++)
        {
            var order = new List<(string A, string B)>(); // first-seen order breaks ties
            var counts = new Dictionary<(string, string), int>();
            foreach (var (symbols, freq) in words)
            {
                for (var i = 0; i < symbols.Count - 1; i++)
                {
                    var pair = (symbols[i], symbols[i + 1]);
                    if (!counts.ContainsKey(pair)) { counts[pair] = 0; order.Add(pair); }
                    counts[pair] += freq;
                }
            }
            var best = order[0];
            foreach (var pair in order) if (counts[pair] > counts[best]) best = pair;
            merges.Add(best);
            Console.WriteLine($"merge {n}: {best.A} + {best.B} -> {best.A + best.B} (count {counts[best]})");
            words = words.Select(w => (Symbols: ApplyMerge(w.Symbols, best.A, best.B), w.Freq)).ToList();
        }

        List<string> Encode(string word)
        {
            var symbols = word.Select(ch => ch.ToString()).Append("_").ToList();
            foreach (var (a, b) in merges) symbols = ApplyMerge(symbols, a, b); // in the order they were learned
            return symbols;
        }

        foreach (var word in new[] { "lowest", "newer", "wider" }) Console.WriteLine($"{word} -> [{string.Join(", ", Encode(word))}]");
        Console.WriteLine($"vocabulary size: {characters.Count} characters + {merges.Count} merges = {characters.Count + merges.Count}");
    }
}
