// String matching and regex backtracking: count character comparisons, never time.
// Look for: naive search costs about n * m on a repetitive text, KMP stays under 2n, and a nested-quantifier regex doubles its step
// count with every extra character when the input almost matches, while the set-based matcher stays polynomial.
// The regex engine below is a small explicit matcher written for this sample. Patterns are trees: Lit(c), Seq(..), Alt(..),
// Plus(node). Every pattern is anchored at both ends, like ^...$.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    class Node
    {
        public string Kind = "";
        public char C;
        public Node[] Kids = new Node[0];
    }

    static Node Lit(char c) => new Node { Kind = "lit", C = c };
    static Node Seq(params Node[] k) => new Node { Kind = "seq", Kids = k };
    static Node Alt(params Node[] k) => new Node { Kind = "alt", Kids = k };
    static Node Plus(Node n) => new Node { Kind = "plus", Kids = new[] { n } };

    static long steps = 0;

    static int NaiveSearch(string text, string pat) // comparisons made while trying every start position
    {
        steps = 0;
        for (int s = 0; s <= text.Length - pat.Length; s++)
        {
            int j = 0;
            for (; j < pat.Length; j++)
            {
                steps++;
                if (text[s + j] != pat[j]) break;
            }
            if (j == pat.Length) return s;
        }
        return -1;
    }

    static int KmpSearch(string text, string pat) // one comparison per attempt; the text index never moves back
    {
        steps = 0;
        var fail = new int[pat.Length];
        int k = 0;
        for (int i = 1; i < pat.Length; i++)
        {
            while (k > 0 && pat[i] != pat[k]) { steps++; k = fail[k - 1]; }
            steps++;
            if (pat[i] == pat[k]) k++;
            fail[i] = k;
        }
        k = 0;
        for (int i = 0; i < text.Length; i++)
        {
            while (k > 0 && text[i] != pat[k]) { steps++; k = fail[k - 1]; }
            steps++;
            if (text[i] == pat[k]) k++;
            if (k == pat.Length) return i - k + 1;
        }
        return -1;
    }

    static bool Bt(Node node, string s, int i, Func<int, bool> k) // backtracking: try a branch, and if the rest fails, come back and try another
    {
        if (node.Kind == "lit")
        {
            steps++;
            return i < s.Length && s[i] == node.C && k(i + 1);
        }
        if (node.Kind == "seq")
        {
            Func<int, int, bool> run = null!;
            run = (idx, j) => idx == node.Kids.Length ? k(j) : Bt(node.Kids[idx], s, j, j2 => run(idx + 1, j2));
            return run(0, i);
        }
        if (node.Kind == "alt")
        {
            foreach (var option in node.Kids) if (Bt(option, s, i, k)) return true;
            return false;
        }
        return Bt(node.Kids[0], s, i, j => Bt(node, s, j, k) || k(j)); // plus: one more repeat first, then stop
    }

    static bool MatchBacktracking(Node pat, string s)
    {
        steps = 0;
        return Bt(pat, s, 0, j => j == s.Length);
    }

    static HashSet<int> Ends(Node node, string s, HashSet<int> starts) // set-based: all end positions reachable from each start
    {
        if (node.Kind == "lit")
        {
            var o = new HashSet<int>();
            foreach (var i in starts)
            {
                steps++;
                if (i < s.Length && s[i] == node.C) o.Add(i + 1);
            }
            return o;
        }
        if (node.Kind == "seq")
        {
            var cur = new HashSet<int>(starts);
            foreach (var part in node.Kids) cur = Ends(part, s, cur);
            return cur;
        }
        if (node.Kind == "alt")
        {
            var o = new HashSet<int>();
            foreach (var option in node.Kids) o.UnionWith(Ends(option, s, starts));
            return o;
        }
        var seen = new HashSet<int>();
        var outSet = new HashSet<int>(); // plus: repeat until no new positions appear
        var frontier = new HashSet<int>(starts);
        while (frontier.Count > 0)
        {
            var nxt = Ends(node.Kids[0], s, new HashSet<int>(frontier.Where(x => !seen.Contains(x))));
            seen.UnionWith(frontier);
            outSet.UnionWith(nxt);
            frontier = new HashSet<int>(nxt.Where(x => !seen.Contains(x)));
        }
        return outSet;
    }

    static bool MatchSets(Node pat, string s)
    {
        steps = 0;
        return Ends(pat, s, new HashSet<int> { 0 }).Contains(s.Length);
    }

    static string Rep(char c, int n) => new string(c, n);

    public static void Main()
    {
        var a = Lit('a');
        var nestedPat = Plus(Plus(a)); // ^(a+)+$
        var ambigPat = Plus(Alt(a, Seq(a, a))); // ^(a|aa)+$
        var simplePat = Plus(a); // ^a+$

        foreach (int n in new[] { 10, 100, 1000 })
        {
            var text = Rep('a', n);
            var pat = Rep('a', 9) + "b";
            NaiveSearch(text, pat);
            long naive = steps;
            KmpSearch(text, pat);
            Console.WriteLine($"text of {n} a's, pattern aaaaaaaaab: naive {naive} comparisons, KMP {steps}");
        }

        foreach (var (name, pat) in new[] { ("^(a+)+$", nestedPat), ("^(a|aa)+$", ambigPat), ("^a+$", simplePat) })
        {
            foreach (int n in new[] { 10, 15, 20 })
            {
                var text = Rep('a', n) + "b"; // a near miss: all a's, then one character that spoils it
                bool ok = MatchBacktracking(pat, text);
                long btSteps = steps;
                MatchSets(pat, text);
                Console.WriteLine($"{name} on {n} a's then b: backtracking {btSteps} steps (match {(ok ? "yes" : "no")}), set-based {steps} steps");
            }
        }

        foreach (int n in new[] { 10, 15, 20 })
        {
            bool ok = MatchBacktracking(nestedPat, Rep('a', n)); // the same pattern on an input that does match
            Console.WriteLine($"^(a+)+$ on {n} a's with no b: backtracking {steps} steps (match {(ok ? "yes" : "no")})");
        }

        // Two rules found by measuring the engine, checked here for n up to 20, then used for larger n.
        var nested = new List<long>();
        var ambig = new List<long>();
        for (int n = 0; n <= 20; n++)
        {
            MatchBacktracking(nestedPat, Rep('a', n) + "b");
            nested.Add(steps);
            MatchBacktracking(ambigPat, Rep('a', n) + "b");
            ambig.Add(steps);
        }
        bool okNested = true, okAmbig = true;
        for (int n = 1; n <= 20; n++) if (nested[n] != (1L << (n + 1)) - 1) okNested = false;
        for (int n = 2; n <= 20; n++) if (ambig[n] != ambig[n - 1] + ambig[n - 2] + 3) okAmbig = false;
        Console.WriteLine($"nested steps = 2^(n+1) - 1 for n = 1..20: {(okNested ? "yes" : "no")}");
        Console.WriteLine($"alternation steps = previous + the one before + 3 for n = 2..20: {(okAmbig ? "yes" : "no")}");
        foreach (int n in new[] { 30, 40, 50 })
        {
            long p = ambig[19], q = ambig[20];
            for (int i = 0; i < n - 20; i++) { long t = p + q + 3; p = q; q = t; }
            Console.WriteLine($"by the rules, n={n}: nested {(1L << (n + 1)) - 1} steps, alternation {q} steps, set-based {2 * n + 1} and {3 * n + 2}");
        }
    }
}
