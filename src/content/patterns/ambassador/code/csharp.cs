// Ambassador in C#. The app asks the ambassador for a rate; the ambassador deals with the flaky partner.
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        var ambassador = new Ambassador();
        foreach (var currency in new[] { "EUR", "GBP", "JPY" }) // the app only asks; it has no retry code
        {
            Console.WriteLine($"app asks for {currency}");
            try { Console.WriteLine($"{currency} = {ambassador.Get(currency)}"); }
            catch (InvalidOperationException error) { Console.WriteLine($"{currency} unavailable: {error.Message}"); }
        }
    }
}

public static class Partner // the remote service
{
    private static readonly Dictionary<string, string> Rates = new() { ["EUR"] = "1.08", ["GBP"] = "1.27", ["JPY"] = "0.0067" };
    private static readonly HashSet<int> FailingCalls = new() { 1, 3, 4, 5 }; // the partner's calls that fail
    private static int _calls;

    public static string Get(string currency)
    {
        _calls++;
        if (FailingCalls.Contains(_calls)) throw new InvalidOperationException("partner error");
        return Rates[currency];
    }
}

// Runs beside the client: retries with a limit, and stops calling a partner that is clearly down.
public class Ambassador(int maxAttempts = 3, int openAfter = 3)
{
    private int _consecutiveFailures;
    private int _calls;

    public string Get(string currency)
    {
        if (_consecutiveFailures >= openAfter)
        {
            Console.WriteLine("[ambassador] circuit open, partner not called");
            throw new InvalidOperationException("circuit open");
        }
        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            _calls++;
            try
            {
                var rate = Partner.Get(currency);
                Console.WriteLine($"[ambassador] call {_calls} ok");
                _consecutiveFailures = 0;
                return rate;
            }
            catch (InvalidOperationException)
            {
                _consecutiveFailures++;
                Console.WriteLine($"[ambassador] call {_calls} failed, {(attempt < maxAttempts ? "retrying" : "giving up")}");
            }
        }
        throw new InvalidOperationException($"partner failed {maxAttempts} times");
    }
}
