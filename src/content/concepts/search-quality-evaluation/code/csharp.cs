// Judging two rankers offline: a judged set (query, document, grade 0 to 3), precision@k, recall@k and NDCG@k per query,
// and an average that depends on which queries you count and how much each one weighs. Scores print in hundredths (integers).
// grades: judged documents of the query; a, b: the ranked lists the two rankers returned; weight: share of real traffic (percent).
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    record Query(string Text, bool Head, int Weight, Dictionary<string, int> Grades, string[] A, string[] B);
    record Metrics(int P, int R, int Ndcg);

    static readonly Query[] Queries =
    {
        new("iphone case", true, 40, new() { ["d1"] = 3, ["d2"] = 3, ["d3"] = 2, ["d4"] = 2, ["d5"] = 1, ["d6"] = 1, ["d7"] = 0, ["d8"] = 0 },
            new[] { "d1", "d2", "d3", "d7", "d4" }, new[] { "d1", "d3", "d7", "d8", "d2" }),
        new("laptop", true, 25, new() { ["d1"] = 3, ["d2"] = 2, ["d3"] = 2, ["d4"] = 1, ["d5"] = 1, ["d6"] = 0, ["d7"] = 0 },
            new[] { "d1", "d2", "d3", "d4", "d6" }, new[] { "d2", "d6", "d1", "d7", "d3" }),
        new("headphones", true, 15, new() { ["d1"] = 3, ["d2"] = 3, ["d3"] = 2, ["d4"] = 1, ["d5"] = 0, ["d6"] = 0, ["d7"] = 0 },
            new[] { "d1", "d2", "d5", "d3", "d4" }, new[] { "d5", "d2", "d6", "d1", "d7" }),
        new("waterproof case for iphone 12 mini", false, 7, new() { ["d1"] = 3, ["d2"] = 2, ["d3"] = 2, ["d4"] = 1, ["d5"] = 0, ["d6"] = 0, ["d7"] = 0 },
            new[] { "d5", "d6", "d4", "d7", "d1" }, new[] { "d2", "d5", "d6", "d1", "d4" }),
        new("quiet mechanical keyboard office", false, 7, new() { ["d1"] = 3, ["d2"] = 3, ["d3"] = 1, ["d4"] = 1, ["d5"] = 0, ["d6"] = 0 },
            new[] { "d3", "d5", "d1", "d6", "d4" }, new[] { "d3", "d5", "d6", "d1", "d4" }),
        new("gift for dad who likes coffee", false, 6, new() { ["d1"] = 3, ["d2"] = 2, ["d3"] = 2, ["d4"] = 1, ["d5"] = 0, ["d6"] = 0, ["d7"] = 0, ["d8"] = 0, ["d9"] = 0 },
            new[] { "d5", "d6", "d7", "d8", "d9" }, new[] { "d1", "d2", "d3", "d4", "d5" }),
    };

    static int Hundredths(double x) => (int)Math.Floor(x * 100 + 0.5);
    static double Dcg(IEnumerable<int> grades) => grades.Select((g, i) => (Math.Pow(2, g) - 1) / Math.Log2(i + 2)).Sum();

    // A document counts as relevant when its grade is 1 or more.
    static Metrics Measure(Query q, string[] ranking, int k)
    {
        var got = ranking.Take(k).Select(d => q.Grades.TryGetValue(d, out var g) ? g : 0).ToList();
        int relevantTotal = q.Grades.Values.Count(g => g > 0);
        int hits = got.Count(g => g > 0);
        var ideal = q.Grades.Values.OrderByDescending(g => g).Take(k);
        return new Metrics(Hundredths((double)hits / k), Hundredths((double)hits / relevantTotal), Hundredths(Dcg(got) / Dcg(ideal)));
    }

    // Weighted average of per-query hundredths, rounded to the nearest hundredth with integer arithmetic only.
    static int Average(int[] values, int[] weights)
    {
        int w = weights.Sum();
        int total = values.Select((v, i) => v * weights[i]).Sum();
        return (2 * total + w) / (2 * w);
    }

    static Metrics[][] Per(int k) => Queries.Select(q => new[] { Measure(q, q.A, k), Measure(q, q.B, k) }).ToArray();

    public static void Main()
    {
        Console.WriteLine("per query at k = 3 and 5 (hundredths): A | B");
        var p3 = Per(3); var p5 = Per(5);
        for (int i = 0; i < Queries.Length; i++)
        {
            var q = Queries[i];
            Console.WriteLine($"  {(q.Head ? "head" : "tail")} \"{q.Text}\": precision@3 {p3[i][0].P} | {p3[i][1].P}, recall@5 {p5[i][0].R} | {p5[i][1].R}, NDCG@5 {p5[i][0].Ndcg} | {p5[i][1].Ndcg}");
        }
        var aN = p5.Select(m => m[0].Ndcg).ToArray();
        var bN = p5.Select(m => m[1].Ndcg).ToArray();
        var mixes = new (string, int[])[]
        {
            ("every query counts the same", Queries.Select(_ => 1).ToArray()),
            ("weighted by traffic", Queries.Select(q => q.Weight).ToArray()),
            ("head queries only", Queries.Select(q => q.Head ? q.Weight : 0).ToArray()),
            ("tail queries only", Queries.Select(q => q.Head ? 0 : q.Weight).ToArray()),
        };
        Console.WriteLine("average NDCG@5 under each query mix: A | B -> winner");
        var winners = new Dictionary<string, string>();
        foreach (var (name, w) in mixes)
        {
            int a = Average(aN, w), b = Average(bN, w);
            winners[name] = a == b ? "tie" : a > b ? "A" : "B";
            Console.WriteLine($"  {name}: {a} | {b} -> {winners[name]}");
        }
        Console.WriteLine($"per query NDCG@5: A better on {p5.Count(m => m[0].Ndcg > m[1].Ndcg)}, B better on {p5.Count(m => m[1].Ndcg > m[0].Ndcg)}");
        Console.WriteLine("one query swings the average (every query counts the same):");
        foreach (var drop in new[] { -1, 5 })
        {
            var w = Enumerable.Range(0, Queries.Length).Select(i => i == drop ? 0 : 1).ToArray();
            int a = Average(aN, w), b = Average(bN, w);
            Console.WriteLine($"  {(drop < 0 ? "all 6 queries" : $"without \"{Queries[drop].Text}\"")}: {a} | {b} -> {(a > b ? "A" : "B")}");
        }
        if (winners["weighted by traffic"] == winners["tail queries only"]) throw new Exception("the query mix should flip the winner");
    }
}
