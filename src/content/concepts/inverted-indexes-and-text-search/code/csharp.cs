// Inverted index: tokenise documents, map each term to a sorted postings list, merge lists for AND/OR, rank with TF-IDF.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;

string[] docs = {
    "Red apple pie recipe",
    "Green apple juice and red apple cider",
    "Apple pie with cream",
    "Red wine, red grapes and red jam",
    "Grape juice recipe",
    "Pie crust recipe with butter",
};
var index = Indexer.Build(docs, 0);
string Show(List<int> l) => l.Count > 0 ? string.Join(" ", l) : "none";
List<int> Ids(string term) => index.TryGetValue(term, out var p) ? p.Select(x => x.Doc).ToList() : new List<int>();

Console.WriteLine($"docs: {docs.Length}, distinct terms: {index.Count}");
foreach (var term in new[] { "apple", "juice", "pie", "red" })
    Console.WriteLine($"{term} -> " + string.Join(" ", index[term].Select(p => $"{p.Doc}:{p.Tf}")));
Console.WriteLine($"AND apple pie -> {Show(Indexer.Intersect(Ids("apple"), Ids("pie")))}");
Console.WriteLine($"OR juice grape -> {Show(Indexer.Union(Ids("juice"), Ids("grape")))}");

const string query = "red apple juice";
Console.WriteLine($"ranked: {query}");
foreach (var (doc, score) in Indexer.Search(index, docs.Length, query, Indexer.TopResults))
    Console.WriteLine($"  doc {doc} {score.ToString("F" + Indexer.ScoreDecimals, CultureInfo.InvariantCulture)} {docs[doc]}");

// New documents go into a small new segment; merging segments gives the same index as building once.
var segA = Indexer.Build(docs[..Indexer.SegmentSplit], 0);
var segB = Indexer.Build(docs[Indexer.SegmentSplit..], Indexer.SegmentSplit);
var merged = Indexer.Merge(segA, segB);
bool same = merged.Count == index.Count && merged.All(kv => index.TryGetValue(kv.Key, out var o) && o.SequenceEqual(kv.Value));
Console.WriteLine($"segments: A has {segA.Count} terms, B has {segB.Count}, merged has {merged.Count}, same as one build: {(same ? "yes" : "no")}");

static class Indexer
{
    static readonly HashSet<string> StopWords = new() { "and", "with", "the", "a", "of" };
    const int MinLengthForPlural = 4; // "grapes" loses its s, "is" and "us" keep it
    public const int TopResults = 3;
    public const int ScoreDecimals = 3;
    public const int SegmentSplit = 3; // documents 0..2 go to segment A, the rest to segment B

    // Lowercase, split on anything that is not a letter, drop stop words, strip a plural s.
    public static List<string> Tokenize(string text) =>
        Regex.Split(text.ToLowerInvariant(), "[^a-z]+")
            .Where(w => w.Length > 0 && !StopWords.Contains(w))
            .Select(w => w.Length >= MinLengthForPlural && w.EndsWith('s') && !w.EndsWith("ss") ? w[..^1] : w)
            .ToList();

    // term -> postings list of (doc id, term frequency), sorted by doc id because documents are added in order.
    public static Dictionary<string, List<(int Doc, int Tf)>> Build(string[] docs, int firstId)
    {
        var index = new Dictionary<string, List<(int Doc, int Tf)>>();
        for (int i = 0; i < docs.Length; i++)
        {
            var counts = new Dictionary<string, int>();
            foreach (var t in Tokenize(docs[i])) counts[t] = counts.GetValueOrDefault(t) + 1;
            foreach (var (t, tf) in counts)
            {
                if (!index.ContainsKey(t)) index[t] = new List<(int Doc, int Tf)>();
                index[t].Add((firstId + i, tf));
            }
        }
        return index;
    }

    // Join the postings lists of two segments (segment B's ids are all larger, so order is kept).
    public static Dictionary<string, List<(int Doc, int Tf)>> Merge(
        Dictionary<string, List<(int Doc, int Tf)>> a, Dictionary<string, List<(int Doc, int Tf)>> b)
    {
        var merged = a.ToDictionary(kv => kv.Key, kv => new List<(int Doc, int Tf)>(kv.Value));
        foreach (var (t, list) in b)
        {
            if (!merged.ContainsKey(t)) merged[t] = new List<(int Doc, int Tf)>();
            merged[t].AddRange(list);
        }
        return merged;
    }

    // Two sorted id lists walked with one pointer each: no sorting, no nested loop.
    public static List<int> Intersect(List<int> a, List<int> b)
    {
        var o = new List<int>(); int i = 0, j = 0;
        while (i < a.Count && j < b.Count)
        {
            if (a[i] == b[j]) { o.Add(a[i]); i++; j++; }
            else if (a[i] < b[j]) i++; else j++;
        }
        return o;
    }

    public static List<int> Union(List<int> a, List<int> b)
    {
        var o = new List<int>(); int i = 0, j = 0;
        while (i < a.Count || j < b.Count)
        {
            if (j >= b.Count || (i < a.Count && a[i] < b[j])) o.Add(a[i++]);
            else if (i >= a.Count || b[j] < a[i]) o.Add(b[j++]);
            else { o.Add(a[i]); i++; j++; }
        }
        return o;
    }

    // Rare terms matter more: idf = ln(1 + N / df). Score of a document = sum of tf * idf over the query terms.
    public static List<(int Doc, double Score)> Search(Dictionary<string, List<(int Doc, int Tf)>> index, int n, string query, int k)
    {
        var scores = new Dictionary<int, double>();
        foreach (var term in Tokenize(query).Distinct())
        {
            var postings = index.GetValueOrDefault(term) ?? new List<(int Doc, int Tf)>();
            double idf = Math.Log(1.0 + (double)n / postings.Count);
            foreach (var (d, tf) in postings) scores[d] = scores.GetValueOrDefault(d) + tf * idf;
        }
        return scores.Select(kv => (Doc: kv.Key, Score: kv.Value))
            .OrderByDescending(x => x.Score).ThenBy(x => x.Doc).Take(k).ToList();
    }
}
