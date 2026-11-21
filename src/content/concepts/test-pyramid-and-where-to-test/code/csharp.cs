// Test Pyramid and Where to Test: one app with 8 known bugs, tested by suites with a different mix of test kinds.
// Look for: which bugs each mix catches, what it costs to run, and how often a run goes red for no reason.
// Model: tests of one kind are ordered by value, so the n-th test of a kind reaches the n-th area it can see.
// need = [unit, integration, e2e]: how many tests of that kind are needed to reach the bug (0 = that kind cannot see it).
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    static readonly string[] Kinds = { "unit", "integration", "e2e" };
    static readonly int[] Cost = { 1, 20, 150 };   // assumed cost units to run one test of each kind
    static readonly int[] Flake = { 0, 10, 50 };   // assumed chance in 1000 that one test fails on its own in one run
    const int Runs = 50;
    static readonly (string, int[])[] Bugs =
    {
        ("Percentage discount rounds down", new[] { 1, 3, 8 }),
        ("Tax wrong at the exact threshold", new[] { 2, 5, 0 }),
        ("Coupons stack in the wrong order", new[] { 3, 6, 10 }),
        ("Order saved with swapped columns", new[] { 0, 1, 4 }),
        ("API sends cents where dollars expected", new[] { 0, 2, 5 }),
        ("Payment timeout set too short", new[] { 0, 3, 0 }),
        ("Pay button wired to the wrong handler", new[] { 0, 0, 1 }),
        ("Session lost after login redirect", new[] { 0, 0, 2 }),
    };
    static readonly (string, int[])[] Suites =
    {
        ("Pyramid", new[] { 60, 12, 3 }),
        ("Trophy", new[] { 20, 30, 5 }),
        ("Ice-cream cone", new[] { 5, 5, 60 }),
        ("Unit tests only", new[] { 200, 0, 0 }),
        ("End-to-end only", new[] { 0, 0, 60 }),
    };

    static long state;
    static int Rand(int n) { state = (state * 48271) % 2147483647; return (int)(state % n); }

    static (int[] found, int cost, int red) Evaluate(int[] counts)
    {
        var found = new int[Bugs.Length];
        for (int b = 0; b < Bugs.Length; b++)
        {
            found[b] = -1;
            for (int i = 0; i < 3; i++)
                if (Bugs[b].Item2[i] > 0 && counts[i] >= Bugs[b].Item2[i]) { found[b] = i; break; }
        }
        int cost = 0;
        for (int i = 0; i < 3; i++) cost += counts[i] * Cost[i];
        state = 42;
        int red = 0;
        for (int r = 0; r < Runs; r++)
        {
            bool flaked = false;
            for (int i = 0; i < 3; i++)
                for (int t = 0; t < counts[i]; t++)
                    if (Rand(1000) < Flake[i]) flaked = true;
            if (flaked) red++;
        }
        return (found, cost, red);
    }

    public static void Main()
    {
        foreach (var (name, counts) in Suites)
        {
            var (found, cost, red) = Evaluate(counts);
            int caught = found.Count(f => f >= 0);
            Console.WriteLine($"{name} ({string.Join("/", counts)}): caught {caught}/{Bugs.Length}, cost {cost}, red runs {red}/{Runs}");
            var missed = Enumerable.Range(0, Bugs.Length).Where(i => found[i] < 0).Select(i => Bugs[i].Item1).ToList();
            Console.WriteLine($"  escaped: {(missed.Count > 0 ? string.Join("; ", missed) : "none")}");
        }
        var pyramid = Evaluate(Suites[0].Item2);
        for (int i = 0; i < Bugs.Length; i++)
            Console.WriteLine($"Pyramid found \"{Bugs[i].Item1}\" via {Kinds[pyramid.found[i]]} tests");
    }
}
