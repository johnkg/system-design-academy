// The traveling salesman problem (shortest round trip through n cities) as the standard example of an NP-hard problem.
// Part 1: how many tours exist, and how long checking them all would take at an ASSUMED one billion tours per second.
// Part 2: the same instance of 6 to 10 fixed cities (Manhattan distance, integers) solved four ways, counted in steps (a step is
//         one city added to a partial tour, or one pair of edges examined by 2-opt): brute force over every order, branch and bound
//         (abandon a partial tour once it is as long as the best known), nearest neighbour, and nearest neighbour plus 2-opt.
// Look for: tours grow factorially; exact answers are cheap for small n and still cheaper with pruning; nearest neighbour is fast and
// lands above the optimum on this instance (the gap varies with the instance); a little local improvement closes part of it.
// BigInt (JavaScript), int (Python) and BigInteger (C#) keep the huge counts exact, so all three languages print the same digits.
using System;
using System.Collections.Generic;
using System.Numerics;

public static class Program
{
    static readonly int[][] Cities = { new[] { 77, 29 }, new[] { 81, 47 }, new[] { 15, 50 }, new[] { 49, 61 }, new[] { 16, 31 }, new[] { 92, 18 }, new[] { 65, 84 }, new[] { 52, 18 }, new[] { 67, 64 }, new[] { 75, 2 } };

    static int Dist(int a, int b) => Math.Abs(Cities[a][0] - Cities[b][0]) + Math.Abs(Cities[a][1] - Cities[b][1]);

    static BigInteger Factorial(int n) { BigInteger f = 1; for (int i = 2; i <= n; i++) f *= i; return f; }

    static int TourLength(List<int> order)
    {
        int s = 0;
        for (int i = 0; i < order.Count; i++) s += Dist(order[i], order[(i + 1) % order.Count]);
        return s;
    }

    static (int best, long steps, long tours) BruteForce(int n) // every order of cities 1..n-1 after city 0
    {
        long steps = 0, tours = 0; int best = int.MaxValue;
        var path = new List<int> { 0 };
        var used = new bool[n]; used[0] = true;
        Action<int> extend = null;
        extend = (length) =>
        {
            if (path.Count == n) { tours++; best = Math.Min(best, length + Dist(path[n - 1], 0)); return; }
            for (int c = 1; c < n; c++)
            {
                if (used[c]) continue;
                steps++;
                used[c] = true; path.Add(c);
                extend(length + Dist(path[path.Count - 2], c));
                path.RemoveAt(path.Count - 1); used[c] = false;
            }
        };
        extend(0);
        return (best, steps, tours);
    }

    static (int best, long steps) BranchAndBound(int n, int bound) // the same search, but a partial tour at least as long as the best known is dropped
    {
        long steps = 0; int best = bound;
        var path = new List<int> { 0 };
        var used = new bool[n]; used[0] = true;
        Action<int> extend = null;
        extend = (length) =>
        {
            if (length >= best) return;
            if (path.Count == n) { best = Math.Min(best, length + Dist(path[n - 1], 0)); return; }
            for (int c = 1; c < n; c++)
            {
                if (used[c]) continue;
                steps++;
                used[c] = true; path.Add(c);
                extend(length + Dist(path[path.Count - 2], c));
                path.RemoveAt(path.Count - 1); used[c] = false;
            }
        };
        extend(0);
        return (best, steps);
    }

    static (List<int> order, int steps) NearestNeighbour(int n)
    {
        var order = new List<int> { 0 };
        var used = new bool[n]; used[0] = true;
        int at = 0, steps = 0;
        for (int s = 1; s < n; s++)
        {
            int pick = -1;
            for (int c = 0; c < n; c++)
            {
                if (used[c]) continue;
                steps++;
                if (pick < 0 || Dist(at, c) < Dist(at, pick)) pick = c; // ties go to the lower city number
            }
            used[pick] = true; order.Add(pick); at = pick;
        }
        return (order, steps);
    }

    static (List<int> order, int steps, int moves) TwoOpt(List<int> start) // reverse a stretch of the tour whenever that shortens it, until no reversal helps
    {
        var order = new List<int>(start);
        int n = order.Count, steps = 0, moves = 0;
        bool improved = true;
        while (improved)
        {
            improved = false;
            for (int i = 1; i < n - 1; i++)
                for (int j = i + 1; j < n; j++)
                {
                    steps++;
                    int a = order[i - 1], b = order[i], c = order[j], d = order[(j + 1) % n];
                    if (Dist(a, c) + Dist(b, d) < Dist(a, b) + Dist(c, d))
                    {
                        order.Reverse(i, j - i + 1);
                        moves++; improved = true;
                    }
                }
        }
        return (order, steps, moves);
    }

    public static void Main()
    {
        BigInteger nsPerSecond = 1000000000, secondsPerYear = 31536000;
        foreach (int n in new[] { 5, 10, 15, 20, 25 })
        {
            BigInteger tours = Factorial(n - 1) / 2; // fix the start city; a tour and its reverse are the same round trip
            BigInteger seconds = tours / nsPerSecond;
            Console.WriteLine($"n={n}: {tours} tours, {seconds} seconds, {seconds / secondsPerYear} years at one billion tours per second");
        }
        // Held-Karp dynamic programming (exact, no enumeration): about n^2 * 2^n steps and n * 2^n stored values. Better, still exponential.
        foreach (int n in new[] { 10, 20, 30, 40 })
        {
            BigInteger states = n * BigInteger.Pow(2, n);
            Console.WriteLine($"n={n}: dynamic programming about {states * n} steps and {states} stored values");
        }
        foreach (int n in new[] { 6, 7, 8, 9, 10 })
        {
            var nn = NearestNeighbour(n); int nnLen = TourLength(nn.order);
            var opt = TwoOpt(nn.order); int optLen = TourLength(opt.order);
            var bf = BruteForce(n); var bb = BranchAndBound(n, nnLen + 1);
            if (bf.best != bb.best) throw new Exception("exact methods disagree");
            Console.WriteLine($"n={n}: optimum {bf.best}; brute force {bf.tours} tours, {bf.steps} steps; branch and bound {bb.steps} steps; " +
                $"nearest neighbour {nnLen} ({nnLen * 100 / bf.best}% of optimum, {nn.steps} steps); with 2-opt {optLen} ({optLen * 100 / bf.best}%, {opt.moves} moves, {opt.steps} steps)");
        }
    }
}
