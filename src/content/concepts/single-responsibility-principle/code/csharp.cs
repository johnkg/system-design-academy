// Single Responsibility Principle: the same payroll report built three ways, hit by the same five change requests.
// Look for: how many classes each request touches, and how much unrelated behaviour (and which other teams' code) sits inside them.
// A design is a list of classes: (name, what it does (each item is a "reason to change"), which classes it calls).
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    record Cls(string Name, string[] Does, string[] Uses);
    record Request(string Text, string[] Touches);
    record Result(List<string> Touched, int Retest, int Reverified, int Bystanders, int Teams);

    static readonly Dictionary<string, string> Actor = new()
    {
        ["overtime"] = "finance", ["tax"] = "finance", ["bonus"] = "finance", ["format"] = "operations", ["storage"] = "IT", ["flow"] = "",
    };

    static readonly (string Name, Cls[] Classes)[] Designs =
    {
        ("One class does everything", new Cls[]
        {
            new("Cli", new string[] { }, new[] { "PayrollReport" }),
            new("PayrollReport", new[] { "overtime", "tax", "bonus", "format", "storage", "flow" }, new string[] { }),
        }),
        ("Split by reason to change", new Cls[]
        {
            new("Cli", new string[] { }, new[] { "PayrollReport" }),
            new("PayrollReport", new[] { "flow" }, new[] { "PayCalculator", "ReportFormatter", "ReportStore" }),
            new("PayCalculator", new[] { "overtime", "tax", "bonus" }, new string[] { }),
            new("ReportFormatter", new[] { "format" }, new string[] { }),
            new("ReportStore", new[] { "storage" }, new string[] { }),
        }),
        ("Over-split: a class per step", new Cls[]
        {
            new("Cli", new string[] { }, new[] { "ReportRunner" }),
            new("ReportRunner", new[] { "flow" }, new[] { "OvertimeCalculator", "TaxCalculator", "BonusCalculator", "HeaderFormatter", "RowFormatter", "FileWriter" }),
            new("OvertimeCalculator", new[] { "overtime" }, new[] { "OvertimeRule", "OvertimeRateTable" }),
            new("OvertimeRule", new[] { "overtime" }, new string[] { }),
            new("OvertimeRateTable", new[] { "overtime" }, new string[] { }),
            new("TaxCalculator", new[] { "tax" }, new[] { "TaxRule", "TaxBracketTable" }),
            new("TaxRule", new[] { "tax" }, new string[] { }),
            new("TaxBracketTable", new[] { "tax" }, new string[] { }),
            new("BonusCalculator", new[] { "bonus" }, new[] { "BonusRule" }),
            new("BonusRule", new[] { "bonus" }, new string[] { }),
            new("HeaderFormatter", new[] { "format" }, new[] { "ColumnLayout" }),
            new("RowFormatter", new[] { "format" }, new[] { "ColumnLayout" }),
            new("ColumnLayout", new[] { "format" }, new string[] { }),
            new("FileWriter", new[] { "storage" }, new[] { "FilePathResolver", "Serializer" }),
            new("FilePathResolver", new[] { "storage" }, new string[] { }),
            new("Serializer", new[] { "storage" }, new string[] { }),
        }),
    };

    static readonly Request[] Requests =
    {
        new("tax rule changes", new[] { "tax" }),
        new("new output format", new[] { "format" }),
        new("new storage", new[] { "storage" }),
        new("overtime rule changes", new[] { "overtime" }),
        new("add a bonus column", new[] { "bonus", "format" }),
    };

    static int Depth(Cls[] classes, string name)
    {
        var c = classes.First(x => x.Name == name);
        int best = 0;
        foreach (var u in c.Uses) best = Math.Max(best, Depth(classes, u));
        return best + 1;
    }

    static Result Analyse(Cls[] classes, Request req)
    {
        var touched = classes.Where(c => c.Does.Any(r => req.Touches.Contains(r))).ToList();
        var retest = new HashSet<string>(touched.Select(c => c.Name));
        bool grew = true;
        while (grew) // anything that calls a retested class must be retested too
        {
            grew = false;
            foreach (var c in classes)
                if (!retest.Contains(c.Name) && c.Uses.Any(u => retest.Contains(u))) { retest.Add(c.Name); grew = true; }
        }
        int reverified = 0, bystanders = 0;
        var teams = new HashSet<string>();
        foreach (var c in classes) if (retest.Contains(c.Name)) reverified += c.Does.Length;
        foreach (var c in touched)
            foreach (var r in c.Does)
                if (!req.Touches.Contains(r))
                {
                    bystanders++;
                    if (Actor[r] != "" && !req.Touches.Any(t => Actor[t] == Actor[r])) teams.Add(Actor[r]);
                }
        return new Result(touched.Select(c => c.Name).ToList(), retest.Count, reverified, bystanders, teams.Count);
    }

    public static void Main()
    {
        foreach (var (name, classes) in Designs)
        {
            Console.WriteLine($"== {name}");
            Console.WriteLine($"  {classes.Length} classes to read to follow one report run, the longest call chain {Depth(classes, "Cli")} deep");
            int t = 0, r = 0, b = 0, o = 0;
            for (int i = 0; i < Requests.Length; i++)
            {
                var a = Analyse(classes, Requests[i]);
                Console.WriteLine($"  R{i + 1} {Requests[i].Text}: edit {a.Touched.Count} ({string.Join(", ", a.Touched)}); retest {a.Retest}; re-verify {a.Reverified} behaviours; bystander behaviours {a.Bystanders}; other teams at risk {a.Teams}");
                t += a.Touched.Count; r += a.Retest; b += a.Bystanders; o += a.Teams;
            }
            Console.WriteLine($"  five requests: {t} classes edited, {r} retests, {b} bystander behaviours, {o} other-team exposures");
        }
    }
}
