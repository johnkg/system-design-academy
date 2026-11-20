// Ranking 8 tiny documents three ways: plain term count, TF-IDF, and BM25 (idf x saturating tf x length normalization).
// Scores are printed in hundredths (integers), so the output is the same in every language.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    static readonly string[] Docs =
    {
        "cheap laptop",
        "cheap laptop with a long battery life for travel and study",
        "laptop laptop cheap laptop laptop laptop best laptop laptop laptop deals laptop laptop laptop laptop laptop laptop shop", // keyword stuffing
        "the review tests the screen the keyboard the speakers and the fan noise of one laptop and notes that the battery lasts all day while the charger is heavy and the price is fair for the quality of the build",
        "battery packs for phones and tablets with fast charging",
        "the best laptop battery replacement guide",
        "desktop computers and monitors for the office",
        "a laptop stand for the desk",
    };
    const string Query = "cheap laptop battery";
    const int Stuffed = 3; // document number of the keyword-stuffed page

    static readonly string[][] Tokens = Docs.Select(d => d.Split(' ')).ToArray();
    static readonly int N = Tokens.Length;
    static readonly double AvgLen = Tokens.Sum(t => t.Length) / (double)N;

    static int DocFreq(string word) => Tokens.Count(t => t.Contains(word));
    static long Hundredths(double s) => (long)Math.Floor(s * 100 + 0.5);

    // mode: "count" | "tfidf" | "bm25". k1 and b come in as integers (k1 x 10, b x 100) so no float is ever printed.
    static List<(int Doc, long Score)> Rank(string query, string mode, int k1x10 = 12, int bx100 = 75)
    {
        double k1 = k1x10 / 10.0, b = bx100 / 100.0;
        var terms = query.Split(' ');
        var scored = new List<(int Doc, long Score)>();
        for (int i = 0; i < Tokens.Length; i++)
        {
            var doc = Tokens[i];
            double s = 0;
            foreach (var w in terms)
            {
                int tf = doc.Count(x => x == w);
                if (tf == 0) continue;
                int df = DocFreq(w);
                if (mode == "count") s += tf;
                else if (mode == "tfidf") s += tf * Math.Log(1 + (double)N / df);
                else s += Math.Log(1 + (N - df + 0.5) / (df + 0.5)) * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc.Length / AvgLen));
            }
            scored.Add((i + 1, mode == "count" ? (long)s : Hundredths(s)));
        }
        return scored.OrderByDescending(x => x.Score).ThenBy(x => x.Doc).ToList();
    }

    static string Top(List<(int Doc, long Score)> r, int n) => string.Join(" ", r.Take(n).Select(x => $"doc{x.Doc}={x.Score}"));
    static int Place(List<(int Doc, long Score)> r, int doc) => r.FindIndex(x => x.Doc == doc) + 1;
    static string Tenth(int hundredths) => (hundredths / 100.0).ToString("0.##", System.Globalization.CultureInfo.InvariantCulture);

    public static void Main()
    {
        Console.WriteLine($"{N} documents, {Tokens.Sum(t => t.Length)} words, longest {Tokens.Max(t => t.Length)} words, shortest {Tokens.Min(t => t.Length)}");
        Console.WriteLine($"query \"{Query}\" (count is in occurrences, the other scores in hundredths)");
        foreach (var (name, mode) in new[] { ("plain count", "count"), ("tf-idf", "tfidf"), ("bm25 k1=1.2 b=0.75", "bm25") })
        {
            var r = Rank(Query, mode);
            Console.WriteLine($"  {name}: {Top(r, 4)}; keyword-stuffed doc{Stuffed} is number {Place(r, Stuffed)}");
        }
        Console.WriteLine("how one term saturates under BM25 (k1=1.2, average-length document), in hundredths of the term weight:");
        Console.WriteLine("  " + string.Join(" ", new[] { 1, 2, 3, 10, 20 }.Select(tf => $"tf{tf}={Hundredths(tf * 2.2 / (tf + 1.2))}")));
        Console.WriteLine("changing k1 (b=0.75):");
        foreach (var k in new[] { 0, 12, 30 }) Console.WriteLine($"  k1={Tenth(k * 10)}: {Top(Rank(Query, "bm25", k, 75), 3)}");
        Console.WriteLine("changing b (k1=1.2):");
        foreach (var b in new[] { 0, 75, 100 }) Console.WriteLine($"  b={Tenth(b)}: {Top(Rank(Query, "bm25", 12, b), 3)}");
        if (Place(Rank(Query, "count"), Stuffed) != 1 || Place(Rank(Query, "bm25"), Stuffed) <= 1)
            throw new Exception("the stuffed page should win on counts and lose on BM25");
    }
}
