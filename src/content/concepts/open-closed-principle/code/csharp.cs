// Open-Closed Principle: a discount calculator with 2 rule types today (regular, member), built three ways.
// Then 1, 3 and 6 new rule types arrive, one at a time. Look for: edits inside existing code, existing branches exposed to
// accidental change, files created, and the cost of the abstraction itself when only 2 variants ever exist.
// A "touch point" is one edit to an existing file, one new file, or one existing branch that sits inside the edited code.
using System;

public static class Program
{
    const int Existing = 2;
    record Design(string Name, int SetupFiles, int NewFilesPerRule, bool ExposesBranches, int InputChangeBase, string Note);

    static readonly Design[] Designs =
    {
        new("Switch on customer type", 1, 0, true, 0, "PriceCalculator holds one branch per rule"),
        new("Strategy-style rules", 5, 1, false, 2, "DiscountRule, PricingEngine, RuleRegistry, 2 rule classes"),
        new("Plug-in framework", 11, 3, false, 4, "rule, factory and descriptor per rule, plus loader, context, registry, engine, interface"),
    };

    // Adding k rules one after another. Each addition edits one existing file (the switch, the registry or the config).
    static (int Edits, int Created, int Exposed, int Touch, int FilesAfter) AddRules(Design d, int k)
    {
        int exposed = 0;
        if (d.ExposesBranches) for (int i = 0; i < k; i++) exposed += Existing + i; // every existing branch is in the edited function
        int edits = k, created = d.NewFilesPerRule * k;
        return (edits, created, exposed, edits + created + exposed, d.SetupFiles + created);
    }

    // A change the abstraction did not expect: every rule now needs the customer's country.
    static int InputChange(Design d, int k)
    {
        if (d.InputChangeBase == 0) return 1; // one function signature
        return d.InputChangeBase + Existing + k; // interface, engine and so on, plus every rule class
    }

    // Total cost from nothing: build the design for the 2 existing rules, then add k.
    static int Total(Design d, int k) => d.SetupFiles + AddRules(d, k).Touch;

    // Smallest number of added rules where design a costs more than design b.
    static int Crossover(Design a, Design b)
    {
        for (int k = 0; k <= 50; k++) if (Total(a, k) > Total(b, k)) return k;
        return -1;
    }

    public static void Main()
    {
        foreach (var d in Designs)
        {
            Console.WriteLine($"== {d.Name} ({d.Note})");
            Console.WriteLine($"  files for the {Existing} rules that exist: {d.SetupFiles}");
            foreach (int k in new[] { 1, 3, 6 })
            {
                var r = AddRules(d, k);
                Console.WriteLine($"  add {k}: {r.Edits} edits to existing files, {r.Created} new files, {r.Exposed} existing branches exposed, {r.Touch} touch points, {r.FilesAfter} files in all; a new input for every rule means editing {InputChange(d, k)} files");
            }
            Console.WriteLine($"  total touch points from scratch with 2 rules: {Total(d, 0)}");
        }
        Console.WriteLine($"strategy-style costs less than the switch from {Crossover(Designs[0], Designs[1])} added rules");
        Console.WriteLine($"plug-in framework costs less than the switch from {Crossover(Designs[0], Designs[2])} added rules");
    }
}
