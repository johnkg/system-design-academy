// An agent loop in C#: a scripted "model" picks actions, the loop runs tools within a step budget.
using System;
using System.Collections.Generic;

public static class Program
{
    private static readonly Dictionary<string, Func<string, string>> Tools = new()
    {
        ["search"] = _ => "3 results: A 120, B 95, C 140",
        ["book"] = arg => $"booked {arg} for 95",
    };
    private static readonly HashSet<string> NeedsApproval = new() { "book" }; // actions that change the world are approved by a person
    private static readonly (string Action, string Argument)[] Script =
    {
        ("search", "flights to Lisbon"), ("book", "B"), ("finish", "Booked flight B for 95"),
    };

    // Stands in for a language model: it picks the next action from what has happened so far.
    private static (string Action, string Argument) ScriptedModel(List<string> history) => Script[history.Count];

    private static void Run(int budget)
    {
        Console.WriteLine($"run with budget {budget}");
        var history = new List<string>();
        for (var step = 1; step <= budget; step++)
        {
            var (action, argument) = ScriptedModel(history);
            if (action == "finish")
            {
                Console.WriteLine($"  step {step}: finish -> {argument}");
                return;
            }
            var approved = NeedsApproval.Contains(action) ? " [approved]" : "";
            var observation = Tools[action](argument);
            history.Add(observation);
            Console.WriteLine($"  step {step}: {action}({argument}){approved} -> {observation}");
        }
        Console.WriteLine($"  budget of {budget} steps used: stopped before finishing");
    }

    public static void Main()
    {
        Run(5);
        Run(2);
    }
}
