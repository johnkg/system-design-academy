// Without the pattern: the app calls the partner directly, with no retry, timeout or breaker policy.
using System;
using System.Collections.Generic;

public static class Program
{
    private static readonly Dictionary<string, string> Rates = new() { ["EUR"] = "1.08", ["GBP"] = "1.27", ["JPY"] = "0.0067" };
    private static int _calls;

    private static string Partner(string currency)
    {
        _calls++;
        if (_calls == 1 || _calls == 3) throw new InvalidOperationException("partner error"); // the partner fails now and then
        return Rates[currency];
    }

    public static void Main()
    {
        foreach (var currency in new[] { "EUR", "GBP", "JPY" })
        {
            Console.WriteLine($"app asks for {currency}");
            try { Console.WriteLine($"{currency} = {Partner(currency)}"); }
            catch (InvalidOperationException error) { Console.WriteLine($"{currency} unavailable: {error.Message}"); } // straight to the user
        }
    }
}
