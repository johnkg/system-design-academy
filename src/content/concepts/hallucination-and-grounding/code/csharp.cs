// A claim checker in C#: a claim is "supported" if all its content words appear in one source sentence.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    private static readonly string[] Sources =
    {
        "the refund window is 30 days from delivery",
        "refunds go back to the original payment method",
        "gift cards cannot be refunded",
    };
    private static readonly string[] Claims =
    {
        "the refund window is 30 days",
        "refunds go to the original payment method",
        "refunds are also sent as store credit",
        "the refund window is 60 days",
    };
    private static readonly HashSet<string> StopWords = new() { "the", "is", "to", "are", "be", "a", "as" };

    private static bool Supported(string claim)
    {
        var words = claim.Split(' ').Where(w => !StopWords.Contains(w)).ToList();
        return Sources.Any(source =>
        {
            var sourceWords = source.Split(' ').ToHashSet();
            return words.All(sourceWords.Contains);
        });
    }

    public static void Main()
    {
        var unsupported = 0;
        foreach (var claim in Claims)
        {
            var ok = Supported(claim);
            if (!ok) unsupported++;
            Console.WriteLine($"{(ok ? "supported:  " : "unsupported:")} {claim}");
        }
        Console.WriteLine($"unsupported claims: {unsupported} of {Claims.Length} ({unsupported * 100 / Claims.Length}%)");
    }
}
