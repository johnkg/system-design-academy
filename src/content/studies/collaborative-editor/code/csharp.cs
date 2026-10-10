// Merging two people's simultaneous edits with operational transformation, in C#:
// each edit is rewritten to account for the other one, so both copies of the text end up identical.
using System;
using System.Linq;

// An operation changes one character: an insert of a character at a position, or a delete of the character at a position.
public record Op(bool Insert, int Pos, char Ch, int Site);

public static class Program
{
    static long seed = 99;
    static int Random(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)(seed / 65536 % n); }

    // A null operation means "nothing to do".
    static string Apply(string text, Op? op)
    {
        if (op == null) return text;
        if (op.Insert) return text.Insert(Math.Min(op.Pos, text.Length), op.Ch.ToString());
        return op.Pos < text.Length ? text.Remove(op.Pos, 1) : text; // an untransformed edit can point past the end
    }

    // Rewrite `a` so it makes the same change after `b` has already been applied.
    static Op? Transform(Op? a, Op? b)
    {
        if (a == null || b == null) return a;
        if (a.Insert && b.Insert)
        {
            if (a.Pos < b.Pos || (a.Pos == b.Pos && a.Site < b.Site)) return a; // same spot: the lower site number goes first, so both sides agree
            return a with { Pos = a.Pos + 1 };
        }
        if (a.Insert && !b.Insert) return a.Pos <= b.Pos ? a : a with { Pos = a.Pos - 1 };
        if (!a.Insert && b.Insert) return a.Pos < b.Pos ? a : a with { Pos = a.Pos + 1 };
        if (a.Pos < b.Pos) return a;                    // both delete: before the other one's position, nothing changes
        if (a.Pos > b.Pos) return a with { Pos = a.Pos - 1 };
        return null;                                     // the same character was already deleted by the other edit
    }

    static Op MakeOp(string text, int site)
    {
        if (text.Length > 0 && Random(2) == 0) return new Op(false, Random(text.Length), ' ', site);
        int pos = Random(text.Length + 1);
        return new Op(true, pos, "abcdefgh"[Random(8)], site);
    }

    public static int Main()
    {
        // A worked example: both people start with "CAT". Alice types X at the very start while Bob deletes the final T.
        string start = "CAT";
        var alice = new Op(true, 0, 'X', 1);
        var bob = new Op(false, 2, ' ', 2);
        string aliceSees = Apply(Apply(start, alice), Transform(bob, alice));
        string bobSees = Apply(Apply(start, bob), Transform(alice, bob));
        string aliceNaive = Apply(Apply(start, alice), bob); // Bob's edit applied as written: position 2 is no longer the T
        string bobNaive = Apply(Apply(start, bob), alice);
        Console.WriteLine($"start \"{start}\": Alice types X at the start, Bob deletes the last letter, at the same time");
        Console.WriteLine($"with transformation: Alice sees \"{aliceSees}\", Bob sees \"{bobSees}\"");
        Console.WriteLine($"without it: Alice sees \"{aliceNaive}\", Bob sees \"{bobNaive}\"");
        if (aliceSees != "XCA" || bobSees != "XCA" || aliceNaive == bobNaive) return 1;

        // Try it on 5,000 random pairs of simultaneous edits.
        const int Trials = 5000;
        int converged = 0, diverged = 0;
        for (int i = 0; i < Trials; i++)
        {
            int length = Random(9);
            string text = new string(Enumerable.Range(0, length).Select(_ => "ABCDEFGH"[Random(8)]).ToArray());
            var a = MakeOp(text, 1);
            var b = MakeOp(text, 2);
            string left = Apply(Apply(text, a), Transform(b, a));
            string right = Apply(Apply(text, b), Transform(a, b));
            if (left == right) converged++;
            if (Apply(Apply(text, a), b) != Apply(Apply(text, b), a)) diverged++; // the same edits applied without any rewriting
        }
        Console.WriteLine($"with transformation: {converged} of {Trials} pairs ended with identical text");
        Console.WriteLine($"without it: {diverged} of {Trials} pairs ended with different text");
        return converged != Trials || diverged == 0 ? 1 : 0;
    }
}
