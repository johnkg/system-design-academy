// Without the pattern: one general API returns everything to every client.
using System;
using System.Collections.Generic;

public static class Program
{
    private static Dictionary<string, object> GeneralOrderApi(int id) => new() // 6 fields for everybody
    {
        ["id"] = id,
        ["customer"] = "Ada",
        ["lines"] = 2,
        ["total"] = "40.00",
        ["shippingAddress"] = "1 Analytical Way",
        ["loyaltyBadge"] = "gold",
    };

    public static void Main()
    {
        var response = GeneralOrderApi(7);
        Console.WriteLine($"general API returns {response.Count} fields");
        Console.WriteLine("mobile uses 2 of them (id, total) and downloads the rest for nothing");
        Console.WriteLine("web uses 4 of them (id, customer, lines, total)");
        // Any change to this response has to be agreed with every client.
    }
}
