// Fail fast and error handling strategies. Part 1 parses the same five inputs with three error styles (an exception, a result value
// the caller must look at, and an error code the caller can forget). Part 2 runs a batch job over 100 records under five
// strategies: swallow and continue, fail fast, retry then fail fast, dead-letter and continue, and retry everything blindly.
// Some records are permanently bad (data errors), some fail a few times and then work (transient errors); in the last scenario
// each record builds on the one before, so continuing past a failure poisons what follows. Look for: the error
// code giving a wrong sum without a sound, which strategies leave wrong data behind, and how much work blind retry wastes.
using System;
using System.Collections.Generic;
using System.Linq;

class ParseError : Exception { public ParseError(string m) : base(m) { } }
class Bad : Exception { }
class Transient : Exception { }

public static class Program
{
    static bool IsNumber(string t) => t.Length > 0 && t.All(c => c >= '0' && c <= '9');

    static int ParseExc(string text) // style 1: raise
    {
        if (!IsNumber(text)) throw new ParseError($"bad number '{text}'");
        return int.Parse(text);
    }
    static (bool, int, string) ParseResult(string text) => // style 2: return a result; the caller has to open it
        IsNumber(text) ? (true, int.Parse(text), "") : (false, 0, $"bad number '{text}'");
    static int ParseCode(string text) => IsNumber(text) ? int.Parse(text) : -1; // style 3: -1 means failure, and nothing makes the caller check

    // Part 2. 100 records. Record i is permanently bad if (i*37) % 100 < bad%, else it fails its first f attempts (f = 1 + i*7 % 3)
    // if (i*53 + 11) % 100 < transient%, and works after that. 37 and 53 are coprime with 100, so the shares are exact.
    static void Work(int i, int attempt, int bad, int trans)
    {
        if ((i * 37) % 100 < bad) throw new Bad();
        if ((i * 53 + 11) % 100 < trans && attempt <= 1 + (i * 7) % 3) throw new Transient();
    }

    static (int, int, int, int, int, int) Run(string strategy, int bad, int trans, int retries, bool dependent)
    {
        int attempts = 0, correct = 0, wrong = 0, parked = 0, unprocessed = 0, noticed = 0;
        bool aborted = false, broken = false;
        int allowed = strategy == "retry" || strategy == "deadletter" || strategy == "blind" ? retries : 0;
        for (int i = 1; i <= 100; i++)
        {
            if (aborted) { unprocessed++; continue; }
            bool failed = true;
            int attempt = 1;
            while (attempt <= 1 + allowed)
            {
                attempts++;
                try
                {
                    Work(i, attempt, bad, trans);
                    failed = false;
                    break;
                }
                catch (Bad)
                {
                    if (strategy != "blind") break; // a data error will not fix itself: only blind retry tries again
                }
                catch (Transient) { }
                attempt++;
            }
            if (!failed)
            {
                if (dependent && broken) wrong++; // computed on top of a record that was skipped or faked
                else correct++;
            }
            else if (strategy == "swallow")
            {
                wrong++; // caught, ignored, a default value saved
                broken = true;
            }
            else if (strategy == "failfast" || strategy == "retry")
            {
                aborted = true; unprocessed++; noticed = i;
            }
            else
            {
                parked++;
                broken = true;
                if (noticed == 0) noticed = i;
            }
        }
        return (correct, wrong, parked, unprocessed, attempts, noticed);
    }

    public static void Main()
    {
        string[] inputs = { "12", "7", "x9", "", "40" };
        int total = 0, k = 0;
        try
        {
            for (k = 1; k <= inputs.Length; k++) total += ParseExc(inputs[k - 1]);
        }
        catch (ParseError e)
        {
            Console.WriteLine($"exception: stopped at item {k}: {e.Message}, partial sum {total}");
        }
        int oks = 0;
        var errs = new List<int>();
        for (int i = 0; i < inputs.Length; i++)
        {
            var (ok, v, _) = ParseResult(inputs[i]);
            if (ok) oks += v; else errs.Add(i + 1);
        }
        Console.WriteLine($"result values: sum {oks}, errors at items {string.Join(", ", errs)}");
        Console.WriteLine($"error codes, never checked: sum {inputs.Sum(t => ParseCode(t))}, nothing flagged");

        var strategies = new[] { ("swallow", "swallow and continue"), ("failfast", "fail fast"), ("retry", "retry, then fail fast"),
            ("deadletter", "dead-letter and continue"), ("blind", "retry everything") };
        foreach (var (bad, trans, retries, dep) in new[] { (0, 20, 3, false), (10, 0, 3, false), (10, 10, 3, false), (10, 10, 3, true) })
        {
            Console.WriteLine($"bad {bad}%, transient {trans}%, retries {retries}, later records depend on earlier ones: {dep.ToString().ToLower()}");
            foreach (var (key, label) in strategies)
            {
                var (c, w, p, u, a, nt) = Run(key, bad, trans, retries, dep);
                Console.WriteLine($"  {label}: correct {c}, wrong {w}, parked {p}, not processed {u}, attempts {a}, noticed at {(nt != 0 ? nt.ToString() : "never")}");
            }
        }
    }
}
