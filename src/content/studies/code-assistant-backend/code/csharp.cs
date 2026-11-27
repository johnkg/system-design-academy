// A code assistant's two core pieces in C#: debouncing with cancellation, and a context ranker.
// Times are in milliseconds and the model's delay is fixed, so the output is the same on every run.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        int[] keys = { 0, 100, 200, 300, 700, 1500 }; // when the developer presses a key
        const int debounce = 250, latency = 400;       // wait for a pause this long, then the model needs this long

        var events = new List<(int Time, string Text)>();
        for (var i = 0; i < keys.Length; i++)
        {
            var nextKey = i + 1 < keys.Length ? keys[i + 1] : int.MaxValue;
            var fire = keys[i] + debounce;
            if (nextKey < fire) continue; // typing went on before the pause was long enough: no request
            events.Add((fire, $"request fired (after key at {keys[i]})"));
            var done = fire + latency;
            if (nextKey < done) events.Add((nextKey, "key: request cancelled")); // a newer key cancels the request in flight
            else events.Add((done, "answer shown"));
        }
        foreach (var (time, text) in events.OrderBy(e => e.Time)) Console.WriteLine($"t={time} {text}");

        // Context: take pieces in priority order, skip any that do not fit in the token budget.
        const int budget = 1000;
        var pieces = new (string Name, int Tokens, int Priority)[]
        {
            ("current file, before cursor", 400, 100),
            ("current file, after cursor", 150, 90),
            ("symbol definition: parse_order", 120, 80),
            ("recent edit: models.py", 250, 70),
            ("open tab: utils.py", 300, 60),
            ("similar code: legacy/orders.py", 500, 40),
            ("README.md", 600, 10),
        };
        Console.WriteLine($"budget {budget} tokens");
        var used = 0;
        foreach (var (name, tokens, _) in pieces.OrderByDescending(p => p.Priority))
        {
            if (used + tokens <= budget)
            {
                used += tokens;
                Console.WriteLine($"+ {name} ({tokens})");
            }
            else
            {
                Console.WriteLine($"- skipped {name} ({tokens}), over budget");
            }
        }
        Console.WriteLine($"used {used} of {budget} tokens");
    }
}
