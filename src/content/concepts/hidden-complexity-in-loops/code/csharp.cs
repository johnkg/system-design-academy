// Hidden complexity in loops: four jobs that look like one loop, each done the naive way and the fixed way.
// Steps are counted by an explicit model, not timed. A step is one comparison, one element moved or one character copied.
// Where a language's own library would hide the cost (`x in list`, `s += piece`, `list.pop(0)`), the loop below is written out
// by hand so the counter sees what the runtime does underneath (real runtimes may optimise some of these cases).
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const long Piece = 4; // characters in one piece of the string being built

    static long FindDuplicatesNaive(int[] ids) // `if x in seen_list` scans the list on every item
    {
        long steps = 0; var seen = new List<int>();
        foreach (var x in ids)
        {
            foreach (var s in seen) { steps++; if (s == x) break; }
            seen.Add(x); steps++;
        }
        return steps;
    }
    static long FindDuplicatesFixed(int[] ids) // a hash set: one lookup and one insert per item (average case, 1 step each)
    {
        long steps = 0; var seen = new HashSet<int>();
        foreach (var x in ids) { steps++; seen.Contains(x); steps++; seen.Add(x); }
        return steps;
    }
    static long BuildStringNaive(long n) // s = s + piece copies the whole growing string each time (in many languages, typically)
    {
        long steps = 0, length = 0;
        for (long i = 0; i < n; i++) { steps += length + Piece; length += Piece; }
        return steps;
    }
    static long BuildStringFixed(long n) // collect the pieces, then join once: every character is copied one time
    {
        long steps = 0; var parts = new List<long>();
        for (long i = 0; i < n; i++) { parts.Add(i); steps++; }
        return steps + n * Piece;
    }
    static long DrainFromFrontNaive(int n) // remove(0) on an array shifts every later element one place left
    {
        long steps = 0; var a = Enumerable.Range(0, n).ToList();
        while (a.Count > 0)
        {
            for (int i = 1; i < a.Count; i++) { a[i - 1] = a[i]; steps++; }
            a.RemoveAt(a.Count - 1); steps++;
        }
        return steps;
    }
    static long DrainFromFrontFixed(int n) // a queue (deque, linked list or ring buffer) takes from the front in one step
    {
        long steps = 0; int head = 0; var a = Enumerable.Range(0, n).ToList();
        while (head < a.Count) { head++; steps++; }
        return steps;
    }
    static long LookupPerRowNaive(int n) // for each row, scan the table for its key (rows come in table order)
    {
        long steps = 0; var table = Enumerable.Range(0, n).ToList();
        for (int row = 0; row < n; row++) foreach (var key in table) { steps++; if (key == row) break; }
        return steps;
    }
    static long LookupPerRowFixed(int n) // build a dictionary once, then one lookup per row
    {
        long steps = 0; var dict = new Dictionary<int, int>();
        for (int i = 0; i < n; i++) { dict[i] = i; steps++; }
        for (int row = 0; row < n; row++) { _ = dict[row]; steps++; }
        return steps;
    }

    static (long, long) Dup(int n)
    {
        var ids = Enumerable.Range(0, n).Select(i => i * 3 + 1).ToArray();
        return (FindDuplicatesNaive(ids), FindDuplicatesFixed(ids));
    }

    public static void Main()
    {
        var tasks = new (string Name, Func<int, (long, long)> Run, Func<long, long> Formula)[]
        {
            ("find duplicates", Dup, n => n * (n - 1) / 2 + n),
            ("build a string", n => (BuildStringNaive(n), BuildStringFixed(n)), n => Piece * n * (n + 1) / 2),
            ("drain from front", n => (DrainFromFrontNaive(n), DrainFromFrontFixed(n)), n => n * (n + 1) / 2),
            ("lookup per row", n => (LookupPerRowNaive(n), LookupPerRowFixed(n)), n => n * (n + 1) / 2),
        };
        foreach (int n in new[] { 10, 100, 1000 })
        {
            Console.WriteLine($"n={n}");
            foreach (var (name, run, formula) in tasks)
            {
                var (naive, fixedSteps) = run(n);
                if (naive != formula(n)) throw new Exception($"model mismatch for {name}");
                Console.WriteLine($"  {name}: naive {naive} steps, fixed {fixedSteps} steps, {naive / fixedSteps}x");
            }
        }
        foreach (var (name, _, formula) in tasks)
        {
            long n = 1;
            while (formula(n) < 1000000000) n++;
            Console.WriteLine($"{name}: the naive version passes 1000000000 steps at n = {n}");
        }
    }
}
