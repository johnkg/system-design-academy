// Ambassador in C#. The app asks the ambassador for a rate; the ambassador deals with the flaky partner.
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        var ambassador = new Ambassador();
        foreach (var currency in new[] { "EUR", "GBP", "JPY", "USD" }) // the app only asks; it has no retry code
        {
            Console.WriteLine($"app asks for {currency}");
            try { Console.WriteLine($"{currency} = {ambassador.Get(currency)}"); }
            catch (InvalidOperationException error) { Console.WriteLine($"{currency} unavailable: {error.Message}"); }
        }
    }
}

public static class Partner // the remote service
{
    private static readonly Dictionary<string, string> Rates = new() { ["EUR"] = "1.08", ["GBP"] = "1.27", ["JPY"] = "0.0067", ["USD"] = "1.00" };
    private static readonly HashSet<int> FailingCalls = new() { 1, 3, 4, 5 }; // the partner's calls that fail
    private static int _calls;

    public static string Get(string currency)
    {
        _calls++;
        if (FailingCalls.Contains(_calls)) throw new InvalidOperationException("partner error");
        return Rates[currency];
    }
}

// Runs beside the client: backs off between retries, and stops calling a partner that is clearly down.
// Timeouts are left out of this toy; real code sets one on every call. Backoff delays are printed, not slept.
public class Ambassador(int maxAttempts = 3, int openAfter = 3, int probeAfter = 1)
{
    private int _consecutiveFailures;
    private int _skipped;
    private int _calls;

    public string Get(string currency)
    {
        var open = _consecutiveFailures >= openAfter;
        if (open && _skipped < probeAfter) // circuit open: fail fast, leave the partner alone
        {
            _skipped++;
            Console.WriteLine("[ambassador] circuit open, partner not called");
            throw new InvalidOperationException("circuit open");
        }
        var attempts = open ? 1 : maxAttempts; // half-open: one probe call decides whether to close the circuit
        for (var attempt = 1; attempt <= attempts; attempt++)
        {
            _calls++;
            try
            {
                var rate = Partner.Get(currency);
                Console.WriteLine($"[ambassador] call {_calls} ok{(open ? " (probe, circuit closes)" : "")}");
                _consecutiveFailures = 0;
                _skipped = 0;
                return rate;
            }
            catch (InvalidOperationException)
            {
                _consecutiveFailures++;
                var delay = 100 * (1 << (attempt - 1)); // exponential backoff: 100 ms, 200 ms, ...
                Console.WriteLine($"[ambassador] call {_calls} failed, {(attempt < attempts ? $"retrying in {delay} ms" : "giving up")}");
            }
        }
        _skipped = 0; // a failed probe keeps the circuit open for another round
        throw new InvalidOperationException($"partner failed {attempts} times");
    }
}
