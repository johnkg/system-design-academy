// An inverted-file (IVF) index in C# on 12 fixed 2-D points: how many distances are computed, and what is missed.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

public static class Program
{
    private static double Dist((double X, double Y) a, (double X, double Y) b) => Math.Sqrt(Math.Pow(a.X - b.X, 2) + Math.Pow(a.Y - b.Y, 2));
    private static string F(double x) => x.ToString("F3", CultureInfo.InvariantCulture);

    public static void Main()
    {
        var points = new Dictionary<string, (double X, double Y)>
        {
            ["p0"] = (0.5, 1.0), ["p1"] = (1.0, 0.5), ["p2"] = (2.4, 1.2), ["p3"] = (1.0, 1.5),
            ["p4"] = (4.5, 1.0), ["p5"] = (5.0, 0.5), ["p6"] = (5.5, 1.5), ["p7"] = (4.8, 1.2),
            ["p8"] = (2.5, 5.0), ["p9"] = (3.0, 4.5), ["p10"] = (3.5, 5.5), ["p11"] = (3.0, 5.0),
        };
        var centroids = new Dictionary<string, (double X, double Y)> { ["A"] = (1.2, 1.0), ["B"] = (5.0, 1.0), ["C"] = (3.0, 5.0) };
        (double X, double Y) query = (3.3, 1.1);

        // Build: each point goes to the list of its nearest centroid.
        var lists = centroids.Keys.ToDictionary(name => name, _ => new List<string>());
        foreach (var (pid, point) in points)
            lists[centroids.Keys.MinBy(c => Dist(point, centroids[c]))!].Add(pid);

        (int Count, string Best) Search(IEnumerable<string> names)
        {
            var candidates = names.SelectMany(name => lists[name]).ToList();
            return (candidates.Count, candidates.MinBy(pid => Dist(points[pid], query))!);
        }

        var (allCount, exact) = Search(centroids.Keys);
        Console.WriteLine($"exact search: {allCount} distances computed, nearest {exact} (distance {F(Dist(points[exact], query))})");

        var ranked = centroids.Keys.OrderBy(c => Dist(centroids[c], query)).ToList(); // the closest lists first
        foreach (var nprobe in new[] { 1, 2 })
        {
            var probed = ranked.Take(nprobe).ToList();
            var (count, best) = Search(probed);
            Console.WriteLine($"IVF, {nprobe} lists probed ({string.Join(", ", probed)}): {count} distances computed, " +
                $"nearest {best} (distance {F(Dist(points[best], query))}), matches exact: {(best == exact ? "yes" : "no")}");
        }
    }
}
