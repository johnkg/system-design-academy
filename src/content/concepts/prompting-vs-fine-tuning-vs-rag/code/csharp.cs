// Choosing a lever in C#: simple rules that turn a team's needs into a recommended order of steps.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    private static readonly (Func<string[], bool> Applies, string Advice)[] Rules =
    {
        (_ => true, "prompting: write clear instructions and a few examples"),
        (n => n.Contains("fresh_facts") || n.Contains("private_docs"), "retrieval: fetch the documents at question time"),
        (n => n.Contains("strict_format"), "structured output: ask for a schema and validate the result"),
        (n => n.Contains("new_style"), "fine-tuning: consider it if prompting cannot hold the style"),
        (n => n.Contains("high_volume_low_latency"), "fine-tuning: a smaller tuned model can replace a long prompt"),
    };

    private static List<string> Choose(string[] needs) => Rules.Where(r => r.Applies(needs)).Select(r => r.Advice).ToList();

    public static void Main()
    {
        var cases = new[]
        {
            Array.Empty<string>(),
            new[] { "fresh_facts" },
            new[] { "new_style", "high_volume_low_latency" },
            new[] { "private_docs", "strict_format" },
        };
        foreach (var needs in cases)
        {
            Console.WriteLine("needs: " + (needs.Length > 0 ? string.Join(", ", needs) : "(none)"));
            var advice = Choose(needs);
            for (var i = 0; i < advice.Count; i++) Console.WriteLine($"  {i + 1}. {advice[i]}");
        }
    }
}
