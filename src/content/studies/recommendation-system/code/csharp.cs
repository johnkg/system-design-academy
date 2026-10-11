// A tiny recommender in C#: popularity, item-to-item co-occurrence, and diversity re-ranking,
// judged on one held-out interaction per user. Cold-start users fall back to popularity, and new items get an exploration slot.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

public record Result(int Hits, int Shown, double Genres, int NewShown);

public static class Program
{
    const int Users = 120, Genres = 6, Per = 8, Items = Genres * Per, K = 5, NewItem = Items; // item 48 is new and has no interactions
    static int GenreOf(int item) => item / Per;

    static long seed = 7;
    static int Random(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)(seed / 65536 % n); }

    static readonly List<List<int>> history = new();
    static readonly List<int> heldOut = new();
    static readonly int[] pop = new int[Items + 1];
    static readonly int[,] co = new int[Items + 1, Items + 1];
    static List<int> popularity = new();

    static double Similarity(int a, int b) => pop[a] == 0 || pop[b] == 0 ? 0 : co[a, b] / Math.Sqrt(pop[a] * pop[b]);

    static List<int> ByPopularity(List<int> items) => popularity.Where(i => !items.Contains(i)).Take(K).ToList();

    // Candidates are ranked by their summed similarity to what the user already liked. A user with no history has no signal, so use popularity.
    static List<(int C, double S)> Ranked(List<int> items)
    {
        double Sum(int c) { double t = 0; foreach (var h in items) t += Similarity(h, c); return t; }
        return Enumerable.Range(0, Items + 1).Where(c => !items.Contains(c)).Select(c => (C: c, S: Sum(c)))
            .OrderByDescending(x => x.S).ThenBy(x => x.C).ToList();
    }

    static List<int> ByCf(List<int> items) => items.Count == 0 ? ByPopularity(items) : Ranked(items).Take(K).Select(x => x.C).ToList();

    // Greedy re-rank of the best 15: each pick divides the score of items of the same genre by 1 + (how many of that genre are already picked).
    static List<int> Diverse(List<int> items)
    {
        if (items.Count == 0) return ByPopularity(items);
        var pool = Ranked(items).Take(15).ToList();
        var picked = new List<int>();
        while (picked.Count < K)
        {
            int best = -1; double bestScore = -1;
            foreach (var (c, s) in pool)
            {
                if (picked.Contains(c)) continue;
                double adj = s / (1 + picked.Count(p => GenreOf(p) == GenreOf(c)));
                if (adj > bestScore) { best = c; bestScore = adj; }
            }
            picked.Add(best);
        }
        return picked;
    }

    // Exploration slot: for every 10th user the last slot shows the new item, so that it can start collecting interactions.
    static List<int> WithExplore(List<int> items, int u)
    {
        var list = Diverse(items);
        return u % 10 == 0 ? list.Take(K - 1).Append(NewItem).ToList() : list;
    }

    static Result Evaluate(string name, Func<List<int>, int, List<int>> recommend)
    {
        int hits = 0, newShown = 0, genreSum = 0; var covered = new HashSet<int>();
        for (int u = 0; u < Users; u++)
        {
            var list = recommend(history[u], u);
            if (list.Contains(heldOut[u])) hits++;
            if (list.Contains(NewItem)) newShown++;
            foreach (var i in list) covered.Add(i);
            genreSum += list.Select(GenreOf).Distinct().Count();
        }
        double genres = (double)genreSum / Users;
        Console.WriteLine($"{name.PadRight(18)} hits {hits}/{Users}, items shown {covered.Count}/{Items + 1}, genres per list {genres.ToString("F2", CultureInfo.InvariantCulture)}, new item shown {newShown}");
        return new Result(hits, covered.Count, genres, newShown);
    }

    public static int Main()
    {
        // Each user mostly likes one genre (user % 6); within a genre, the low item numbers are the popular ones.
        for (int u = 0; u < Users; u++)
        {
            var seen = new List<int>();
            while (seen.Count < 12)
            {
                int g = Random(10) < 8 ? u % Genres : Random(Genres);
                int item = g * Per + Math.Min(Random(Per), Random(Per));
                if (!seen.Contains(item)) seen.Add(item);
            }
            heldOut.Add(seen[^1]); // the last interaction is hidden from training and used as the test
            seen.RemoveAt(seen.Count - 1);
            history.Add(seen);
        }

        // "Training": count how popular each item is, and how often two items were liked by the same user.
        foreach (var items in history)
            foreach (var a in items) { pop[a]++; foreach (var b in items) if (a != b) co[a, b]++; }
        popularity = Enumerable.Range(0, Items + 1).OrderByDescending(i => pop[i]).ThenBy(i => i).ToList();

        var pa = Evaluate("popularity", (items, u) => ByPopularity(items));
        var pb = Evaluate("item-to-item CF", (items, u) => ByCf(items));
        var pc = Evaluate("CF + diversity", (items, u) => Diverse(items));
        var pd = Evaluate("CF + explore slot", WithExplore);
        var cold = Diverse(new List<int>());
        Console.WriteLine($"cold-start user gets the popular items: {string.Join(", ", cold)}");

        bool ok = pb.Hits > pa.Hits && pb.Shown > pa.Shown && pc.Genres > pb.Genres && pc.Shown >= pb.Shown
            && pb.NewShown == 0 && pd.NewShown == 12 && cold.SequenceEqual(popularity.Take(K));
        Console.WriteLine($"CF beats popularity, diversity widens lists, new item only via exploration: {ok.ToString().ToLowerInvariant()}");
        return ok ? 0 : 1;
    }
}
