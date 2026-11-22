// Tokenization and audit scope: which of your systems ever see a card number, and what a token is.
// A fixed list of 8 components, three ways to take a card, and a toy token vault. Only integers and fixed text are printed.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    static readonly string[] Components = { "Checkout page", "Web server", "App API", "Payment service", "Database", "Log pipeline", "Backups", "Analytics warehouse" };

    record Options(bool Store = false, bool LogBodies = false, bool Backups = false, bool Warehouse = false);

    // design: "form" (your page has the card form and posts the number to your server), "hosted" (your page embeds fields
    // served by the provider; the number goes from the browser to the provider), "redirect" (the customer pays on the
    // provider's own page).
    static (bool[] InScope, int Count, List<string> AtRest, string Audit) Analyze(string design, Options o)
    {
        var inScope = new bool[Components.Length];
        var atRest = new List<string>();
        if (design == "form")
        {
            for (int i = 0; i < 4; i++) inScope[i] = true; // the number is typed into, sent through and processed by these
            if (o.Store) { inScope[4] = true; atRest.Add(Components[4]); }
            if (o.LogBodies) { inScope[5] = true; atRest.Add(Components[5]); }
            if (o.Store && o.Backups) { inScope[6] = true; atRest.Add(Components[6]); }
            if (o.Store && o.Warehouse) { inScope[7] = true; atRest.Add(Components[7]); }
        }
        else
        {
            // hosted: your page serves the code around the provider's fields, so it can still affect them
            // redirect: your page decides where the customer is sent, so a tampered page could send them to a fake payment page
            inScope[0] = true;
        }
        int count = inScope.Count(x => x);
        bool serverSide = inScope.Skip(1).Any(x => x);
        string audit = serverSide ? "heavy" : "light";
        return (inScope, count, atRest, audit);
    }

    // Luhn check: catches a mistyped number before it is sent anywhere.
    static bool LuhnValid(string digits)
    {
        int sum = 0;
        for (int i = 0; i < digits.Length; i++)
        {
            int d = digits[digits.Length - 1 - i] - '0';
            if (i % 2 == 1) { d *= 2; if (d > 9) d -= 9; }
            sum += d;
        }
        return sum % 10 == 0;
    }

    static string Mask(string pan) => pan.Substring(0, 6) + new string('*', pan.Length - 10) + pan.Substring(pan.Length - 4);

    // A toy vault: the token comes from a counter-like generator, so it has no mathematical link to the number.
    class Vault
    {
        long state;
        readonly Dictionary<string, string> map = new();
        public Vault(long seed) { state = seed; }
        public string Tokenize(string pan)
        {
            state = (state * 48271) % 2147483647;
            string token = "tok_" + state.ToString().PadLeft(10, '0');
            map[token] = pan;
            return token;
        }
        public string? Detokenize(string token) => map.TryGetValue(token, out var pan) ? pan : null;
    }

    public static void Main()
    {
        Console.WriteLine("-- card number checks");
        string pan = "4111111111111111"; // a well-known test number
        Console.WriteLine($"{Mask(pan)} has {pan.Length} digits, last 4 {pan.Substring(pan.Length - 4)}, Luhn valid {(LuhnValid(pan) ? 1 : 0)}");
        Console.WriteLine($"one digit changed: Luhn valid {(LuhnValid("4111111111111112") ? 1 : 0)}");

        Console.WriteLine("-- token vault");
        var providerVault = new Vault(987654);
        var otherVault = new Vault(7);
        string t1 = providerVault.Tokenize(pan);
        string t2 = providerVault.Tokenize(pan);
        Console.WriteLine($"two tokens for the same card: {t1} and {t2}, equal {(t1 == t2 ? 1 : 0)}");
        Console.WriteLine($"provider resolves {t1}: {(providerVault.Detokenize(t1) == pan ? "the card" : "nothing")}");
        Console.WriteLine($"another merchant's vault resolves {t1}: {(otherVault.Detokenize(t1) == null ? "nothing" : "the card")}");
        Console.WriteLine($"your database holds: token {t1}, last4 {pan.Substring(pan.Length - 4)}, expiry 12/2030 (no number)");

        Console.WriteLine("-- scope for 8 components");
        var all = new Options(true, true, true, true);
        var cases = new (string Label, string Design, Options O)[]
        {
            ("form, nothing stored or logged", "form", new Options()),
            ("form, number stored", "form", new Options(Store: true)),
            ("form, number stored and request bodies logged", "form", new Options(Store: true, LogBodies: true)),
            ("form, stored, logged, backed up, copied to analytics", "form", all),
            ("hosted fields, token stored, bodies logged, backed up", "hosted", all),
            ("redirect, token stored, bodies logged, backed up", "redirect", all),
        };
        foreach (var (label, design, o) in cases)
        {
            var (inScope, count, atRest, audit) = Analyze(design, o);
            string names = string.Join(", ", Components.Where((_, i) => inScope[i]));
            if (names.Length == 0) names = "none";
            string rest = atRest.Count > 0 ? string.Join(", ", atRest) : "none";
            Console.WriteLine($"{label}: {count} of {Components.Length} in scope ({names}); numbers at rest in {rest}; audit {audit}");
        }
    }
}
