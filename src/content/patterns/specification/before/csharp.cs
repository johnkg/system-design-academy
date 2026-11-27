// Without the pattern: the rule is an if-chain, copied into every place that needs it.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    private record Customer(string Name, bool Active, bool Blocked, int Total);

    private static readonly List<Customer> Customers = new()
    {
        new("ada", true, false, 120), new("bob", true, true, 200),
        new("cy", false, false, 150), new("dee", true, false, 60),
    };

    public static void Main()
    {
        DiscountScreen();
        EmailCampaign();
    }

    private static void DiscountScreen()
    {
        var yes = Customers.Where(c => c.Active && !c.Blocked && c.Total >= 100).Select(c => c.Name);
        Console.WriteLine($"Discount screen: {string.Join(", ", yes)}");
    }

    private static void EmailCampaign()
    {
        // Copied from the discount screen. Someone changes 100 to 150 above and forgets this one.
        var yes = Customers.Where(c => c.Active && !c.Blocked && c.Total >= 100).Select(c => c.Name);
        Console.WriteLine($"Email campaign: {string.Join(", ", yes)}");
    }
}
