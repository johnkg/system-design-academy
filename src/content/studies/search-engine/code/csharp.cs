// A tiny search engine in C#: analysis, an inverted index with positions, AND and phrase queries,
// BM25 ranking, and document-sharded scatter-gather whose merged answer must equal the answer of one big index.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

public record Posting(int Id, List<int> Pos);
public record Hit(int Id, double Score);

public class Index
{
    public Dictionary<string, List<Posting>> Terms = new(); // term -> postings sorted by doc id
    public Dictionary<int, int> Length = new();             // doc id -> number of words

    public void Add(int id, string text)
    {
        Length[id] = text.Split(' ').Length;
        foreach (var (term, pos) in Engine.Analyse(text))
        {
            if (!Terms.TryGetValue(term, out var list)) Terms[term] = list = new List<Posting>();
            if (list.Count == 0 || list[^1].Id != id) list.Add(new Posting(id, new List<int>()));
            list[^1].Pos.Add(pos);
        }
    }
}

public static class Engine
{
    static readonly HashSet<string> Stop = new() { "the", "of", "a" };
    static readonly string[] Bases = { "search", "index", "shard", "rank", "segment", "term", "token", "filter", "match", "load" };
    const int Skip = 8; // a skip pointer every 8 postings

    static string Stem(string w)
    {
        if (w.Length > 5 && w.EndsWith("ing")) return w[..^3];
        if (w.Length > 4 && w.EndsWith("ed")) return w[..^2];
        if (w.Length > 4 && w.EndsWith("es")) return w[..^2];
        if (w.Length > 3 && w.EndsWith("s")) return w[..^1];
        return w;
    }

    // Lowercase, drop stop words (their positions stay as gaps) and stem.
    public static List<(string Term, int Pos)> Analyse(string text) =>
        text.ToLowerInvariant().Split(' ').Select((w, pos) => (w, pos)).Where(x => !Stop.Contains(x.w)).Select(x => (Stem(x.w), x.pos)).ToList();

    // Seeded generator, so every run builds the same corpus.
    static uint state = 42;
    static int Next(int n) { state = unchecked(state * 1664525u + 1013904223u); return (int)((state >> 16) % (uint)n); }

    static string MakeDoc()
    {
        var words = new List<string>();
        for (int i = 8 + Next(13); i > 0; i--)
        {
            if (Next(5) == 0) { words.Add(new[] { "the", "of", "a" }[Next(3)]); continue; }
            int r = Next(100);
            string b = Bases[r * r * r / 100000]; // low-numbered words are much more common
            words.Add(b + new[] { "", b.EndsWith("x") || b.EndsWith("ch") ? "es" : "s", "ed", "ing" }[Next(4)]);
        }
        return string.Join(" ", words);
    }

    // First posting with id >= target, using skip pointers; cost counts every posting touched.
    static int Advance(List<Posting> list, int from, int target, int[] cost)
    {
        int i = from;
        while (i + Skip < list.Count && list[i + Skip].Id <= target) { i += Skip; cost[0]++; }
        while (i < list.Count && list[i].Id < target) { i++; cost[0]++; }
        return i;
    }

    static List<int> Intersect(Index index, string[] terms, bool shortestFirst, int[] cost)
    {
        var lists = terms.Select(t => index.Terms.TryGetValue(t, out var l) ? l : new List<Posting>()).ToList();
        if (shortestFirst) lists = lists.OrderBy(l => l.Count).ToList(); // OrderBy is stable
        var ptr = new int[lists.Count]; var result = new List<int>();
        foreach (var lead in lists[0])
        {
            cost[0]++; bool ok = true;
            for (int k = 1; k < lists.Count && ok; k++) { ptr[k] = Advance(lists[k], ptr[k], lead.Id, cost); ok = ptr[k] < lists[k].Count && lists[k][ptr[k]].Id == lead.Id; }
            if (ok) result.Add(lead.Id);
        }
        return result;
    }

    static List<int> Positions(Index index, string term, int id) => index.Terms[term].First(p => p.Id == id).Pos;
    static bool HasPhrase(Index index, int id, string[] terms) =>
        Positions(index, terms[0], id).Any(p0 => terms.Select((t, k) => Positions(index, t, id).Contains(p0 + k)).All(x => x));

    // BM25 with global statistics, so every shard scores on the same scale.
    static double Bm25(Index index, int n, double avg, Dictionary<string, int> df, string[] terms, int id)
    {
        double score = 0;
        foreach (var t in terms)
        {
            int tf = Positions(index, t, id).Count; double d = df[t];
            score += Math.Log(1 + (n - d + 0.5) / (d + 0.5)) * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * index.Length[id] / avg));
        }
        return score;
    }

    static List<Hit> TopK(Index index, int n, double avg, Dictionary<string, int> df, string[] terms, int k) =>
        Intersect(index, terms, true, new int[1]).Select(id => new Hit(id, Bm25(index, n, avg, df, terms, id)))
            .OrderByDescending(h => h.Score).ThenBy(h => h.Id).Take(k).ToList();

    public static int Main()
    {
        var docs = Enumerable.Range(0, 600).Select(_ => MakeDoc()).ToList();
        var whole = new Index(); var shards = new[] { new Index(), new Index(), new Index() };
        for (int id = 0; id < docs.Count; id++) { whole.Add(id, docs[id]); shards[id % 3].Add(id, docs[id]); }
        int n = whole.Length.Count; double avg = (double)whole.Length.Values.Sum() / n;
        var df = whole.Terms.ToDictionary(kv => kv.Key, kv => kv.Value.Count);

        var query = Analyse("searching the matched tokens").Select(x => x.Term).ToArray();
        Console.WriteLine($"corpus: {docs.Count} documents, {whole.Terms.Count} terms; query terms: {string.Join(" ", query)}");
        Console.WriteLine("posting list lengths: " + string.Join(" ", query.Select(t => $"{t}={whole.Terms[t].Count}")));
        var inOrder = new int[1]; var shortest = new int[1];
        var a = Intersect(whole, query, false, inOrder); var b = Intersect(whole, query, true, shortest);
        Console.WriteLine($"AND matches: {a.Count}; postings read in query order: {inOrder[0]}, shortest list first: {shortest[0]}");
        var phraseTerms = query[1..]; var phrase = a.Where(id => HasPhrase(whole, id, phraseTerms)).ToList();
        Console.WriteLine($"phrase \"{string.Join(" ", phraseTerms)}\" matches: {phrase.Count}");

        var single = TopK(whole, n, avg, df, query, 5);
        var merged = shards.SelectMany(s => TopK(s, n, avg, df, query, 5)).OrderByDescending(h => h.Score).ThenBy(h => h.Id).Take(5).ToList();
        foreach (var r in single.Take(3)) Console.WriteLine($"doc {r.Id} score {r.Score.ToString("F4", CultureInfo.InvariantCulture)}: {docs[r.Id]}");
        bool same = single.SequenceEqual(merged);
        Console.WriteLine($"3 shards merged equals one index: {(same ? "true" : "false")}");
        return !same || a.Count != b.Count || shortest[0] >= inOrder[0] || phrase.Count == 0 ? 1 : 0;
    }
}
