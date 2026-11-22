// KISS, YAGNI and premature abstraction. Part 1 writes one report exporter twice (plain function vs. a registry, config and factory
// built for formats nobody asked for) and counts the calls one report goes through. Part 2 shows the case where planning ahead IS
// right: a stored record with a version field vs. one without. Part 3 counts the touch points of a year of 12 change requests
// (10 inside the code, 2 on the public contract) for three designs. Look for: 1 call vs 7, the old reader silently misreading a
// new record, and where speculation starts to pay (only at a 90% hit rate).
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    static readonly List<string> Trace = new();
    static readonly (string, int)[] Rows = { ("tea", 3), ("milk", 12), ("rice", 40) };

    // Part 1a. Simple: one function that does today's job.
    static string ExportCsv((string, int)[] rows)
    {
        Trace.Add("export_csv");
        return string.Join("\n", rows.Select(r => $"{r.Item1},{r.Item2}"));
    }

    // Part 1b. Speculative: an exporter registry, a config file and a factory, for JSON and XML that were "bound to come".
    static string JoinRow(string[] cells)
    {
        Trace.Add("join_row");
        return string.Join(",", cells);
    }
    static string CsvExporter((string, int)[] rows)
    {
        Trace.Add("csv_exporter");
        return string.Join("\n", rows.Select(r => JoinRow(new[] { r.Item1, r.Item2.ToString() })));
    }
    static readonly Dictionary<string, Func<(string, int)[], string>> Registry = new() { ["csv"] = CsvExporter }; // json and xml were planned, never written
    static readonly Dictionary<string, string> Config = new() { ["format"] = "csv" };
    static Dictionary<string, string> LoadConfig()
    {
        Trace.Add("load_config");
        return Config;
    }
    static Func<(string, int)[], string> GetExporter(string fmt)
    {
        Trace.Add("get_exporter");
        return Registry[fmt];
    }
    static string ExportReport((string, int)[] rows)
    {
        Trace.Add("export_report");
        return GetExporter(LoadConfig()["format"])(rows);
    }

    // Part 2. Planning ahead that is right: a stored record. Files written today are read for years, by readers you cannot update.
    static string ReadV0(string line) // reads "qty,name"
    {
        int i = line.IndexOf(',');
        return $"qty={line.Substring(0, i)} name={line.Substring(i + 1)}";
    }
    static string WriteV2(int qty, string cur, string name) => $"v2|{qty}|{cur}|{name}"; // a new field is added later
    static string ReadVersioned(string line, int newest) // a reader that knows its versions and says so when it meets a newer one
    {
        var p = line.Split('|');
        if (p[0] == "v1" && newest >= 1) return $"qty={p[1]} name={p[2]}";
        if (p[0] == "v2" && newest >= 2) return $"qty={p[1]} cur={p[2]} name={p[3]}";
        return $"error: unknown version {p[0]}";
    }

    // Part 3. A year of 12 change requests: 10 inside the code, 2 on the public contract. Touch points = places a person must edit.
    // simple:      build 3; an internal change 2 (edit, test); a contract change costs the "late" price L.
    // speculative: build 3 + 6 (interface, registry, config, two exporters nobody asked for); a guessed change 1 (add a class),
    //              a missed one 4 (the interface, the factory, every exporter, the config); a contract change costs L.
    // targeted:    simple code, plus 2 points up front for a version field and a rule to reject unknown versions;
    //              an internal change 2; a contract change 1 (add a version).
    const int Internal = 10, Contract = 2;

    static int Year(string design, int hit, int late)
    {
        if (design == "simple") return 3 + Internal * 2 + Contract * late;
        if (design == "speculative")
        {
            int h = Internal * hit / 100;
            return 9 + h * 1 + (Internal - h) * 4 + Contract * late;
        }
        return 5 + Internal * 2 + Contract * 1;
    }

    public static void Main()
    {
        string a = ExportCsv(Rows);
        int callsSimple = Trace.Count;
        int namesSimple = new HashSet<string>(Trace).Count;
        Trace.Clear();
        string b = ExportReport(Rows);
        Console.WriteLine($"same output: {(a == b).ToString().ToLower()}");
        Console.WriteLine($"calls for one report: simple {callsSimple}, speculative {Trace.Count}");
        Console.WriteLine($"different names to read: simple {namesSimple}, speculative {new HashSet<string>(Trace).Count}");

        Console.WriteLine("old reader, unversioned, new record 3,EUR,tea: " + ReadV0("3,EUR,tea"));
        Console.WriteLine("old reader, versioned, new record: " + ReadVersioned(WriteV2(3, "EUR", "tea"), 1));
        Console.WriteLine("new reader, versioned, new record: " + ReadVersioned(WriteV2(3, "EUR", "tea"), 2));

        var surfaces = new (string, int)[] { ("internal function", 1), ("public API", 9), ("stored file format", 15) };
        foreach (var (name, late) in surfaces)
            foreach (int hit in new[] { 0, 50, 90, 100 })
                Console.WriteLine($"{name}, guess right {hit}%: simple {Year("simple", hit, late)}, " +
                    $"speculative {Year("speculative", hit, late)}, targeted {Year("targeted", hit, late)}");
        int first = -1;
        for (int h = 0; h <= 100; h += 10) if (Year("speculative", h, 1) <= Year("simple", h, 1)) { first = h; break; }
        Console.WriteLine($"speculation matches simple from a hit rate of {first}%");
    }
}
