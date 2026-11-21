// Property-Based Testing and Fuzzing: a run-length encoder with a bug that only appears for runs of 10 or more equal characters.
// Look for: hand-written examples all pass; generated inputs find the bug only if the generator can produce long runs;
// a weak property never fails; and shrinking turns a failing input of 13 to 19 characters into the smallest one that still fails.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

public static class Program
{
    static string Encode(string s) // "aaab" -> "3a1b". BUG: a run of 10 or more is written as run % 10, so 10 a's become "0a"
    {
        var o = new StringBuilder(); int i = 0;
        while (i < s.Length)
        {
            int j = i;
            while (j < s.Length && s[j] == s[i]) j++;
            o.Append((j - i) % 10).Append(s[i]);
            i = j;
        }
        return o.ToString();
    }

    static string Decode(string e)
    {
        var o = new StringBuilder(); int i = 0;
        while (i < e.Length)
        {
            int n = 0;
            while (e[i] >= '0' && e[i] <= '9') { n = n * 10 + (e[i] - '0'); i++; }
            o.Append(e[i], n);
            i++;
        }
        return o.ToString();
    }

    static long state;
    static int Rand(int n) { state = (state * 48271) % 2147483647; return (int)(state % n); }

    const string Letters = "abcdefghijklmnopqrstuvwxyz";
    static string GenLetters() { var s = new StringBuilder(); for (int n = Rand(21); n > 0; n--) s.Append(Letters[Rand(26)]); return s.ToString(); }
    static string GenAb() { var s = new StringBuilder(); for (int n = Rand(21); n > 0; n--) s.Append("ab"[Rand(2)]); return s.ToString(); }
    static string GenRepeats()
    {
        var s = new StringBuilder();
        for (int n = Rand(21); n > 0; n--) s.Append(s.Length > 0 && Rand(10) < 8 ? s[s.Length - 1] : "abc"[Rand(3)]);
        return s.ToString();
    }

    static (string small, int steps) Shrink(string s, Func<string, bool> prop) // keep deleting one character while the property still fails
    {
        int steps = 0; bool again = true;
        while (again)
        {
            again = false;
            for (int i = 0; i < s.Length; i++)
            {
                string smaller = s.Remove(i, 1);
                if (!prop(smaller)) { s = smaller; steps++; again = true; break; }
            }
        }
        return (s, steps);
    }

    static (int found, int size, string small, int steps)? Search(Func<string> gen, Func<string, bool> prop, int seed, int cases)
    {
        state = seed;
        for (int c = 1; c <= cases; c++)
        {
            string s = gen();
            if (!prop(s)) { var (small, steps) = Shrink(s, prop); return (c, s.Length, small, steps); }
        }
        return null;
    }

    public static void Main()
    {
        string[] examples = { "", "a", "aaabcc", "abab", "zzzzzzzzz" }; // the longest run is 9: the bug is out of sight
        var props = new (string, Func<string, bool>)[]
        {
            ("round trip: decode(encode(s)) equals s", s => Decode(Encode(s)) == s),
            ("weak: encode(s) is not empty when s is not", s => s.Length == 0 || Encode(s).Length > 0),
        };
        var gens = new (string, Func<string>)[]
        {
            ("letters a to z, uniform", GenLetters), ("letters a and b, uniform", GenAb), ("biased toward repeats", GenRepeats),
        };
        Console.WriteLine($"examples passing: {examples.Count(s => props[0].Item2(s))}/{examples.Length}");
        foreach (var (pname, prop) in props)
            foreach (var (gname, gen) in gens)
                foreach (int seed in new[] { 101, 202, 303 })
                {
                    var r = Search(gen, prop, seed, 1000);
                    string text = r.HasValue
                        ? $"failed at case {r.Value.found} ({r.Value.size} chars), shrunk to {r.Value.small.Length} chars \"{r.Value.small}\" in {r.Value.steps} steps"
                        : "no failure in 1000 cases";
                    Console.WriteLine($"{pname} | {gname} | seed {seed}: {text}");
                }
        var first = Search(GenRepeats, props[0].Item2, 101, 1000);
        var again = Search(GenRepeats, props[0].Item2, 101, 1000);
        Console.WriteLine($"replay seed 101: same failing case again: {(first.Value.found == again.Value.found && first.Value.small == again.Value.small).ToString().ToLower()}");
    }
}
