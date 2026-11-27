// Without the pattern: billing reads the CRM's records directly, so the CRM's model spreads through it.
using System;
using System.Collections.Generic;

public static class Program
{
    private static readonly Dictionary<int, (string CUST_NM, string STAT_CD, string BAL_AMT)> Records = new()
    {
        [1] = ("LOVELACE, ADA", "A", "000012050"),
        [2] = ("HOPPER, GRACE", "X", "000000000"),
        [3] = ("BABBAGE, CHARLES", "Q", "000000500"),
    };

    private static string Cents(int c) => $"{c / 100}.{c % 100:00}";
    private static string Cap(string w) => char.ToUpper(w[0]) + w[1..].ToLower();

    private static void Describe(int id) // billing code knows column names, code letters and formats
    {
        var rec = Records[id];
        var parts = rec.CUST_NM.Split(", ");
        var status = rec.STAT_CD == "A" ? "active" : "closed"; // "Q" is quietly treated as closed
        Console.WriteLine($"{Cap(parts[1])} {Cap(parts[0])}, {status}, balance {Cents(int.Parse(rec.BAL_AMT))}");
    }

    public static void Main()
    {
        foreach (var id in new[] { 1, 2, 3 }) Describe(id);
        // Every other billing function repeats these rules, and the unknown code "Q" is never noticed.
    }
}
