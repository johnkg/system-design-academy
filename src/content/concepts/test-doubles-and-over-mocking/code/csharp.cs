// Test Doubles and Over-Mocking: an order service tested with stubs, strict mocks, mocks of everything, fakes and a contract test.
// Look for: which of 6 real bugs each style catches, and how many harmless refactors each style breaks.
// The service reserves stock, charges a payment gateway and releases the stock if the card is declined.
// The REAL gateway wants charge(currency, amount, key) with a non-empty key. A hand-written fake follows the older rules (no key).
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    static readonly (string sku, int price, int qty)[] Order = { ("pen", 150, 4), ("book", 1999, 1) }; // 2599 in total
    static readonly (string name, HashSet<string> flags, string kind)[] Configs =
    {
        ("Healthy service", new HashSet<string>(), "ok"),
        ("Charges dollars, not cents", new HashSet<string> { "dollars" }, "bug"),
        ("Stock not released after a decline", new HashSet<string> { "noRelease" }, "bug"),
        ("Charges once per line, not once per order", new HashSet<string> { "perLine" }, "bug"),
        ("Charge arguments in the wrong order", new HashSet<string> { "swap" }, "bug"),
        ("No idempotency key sent", new HashSet<string> { "noKey" }, "bug"),
        ("Line totals added twice in the calculator", new HashSet<string> { "twice" }, "bug"),
        ("Refactor: an extra stock lookup", new HashSet<string> { "extraLookup" }, "refactor"),
        ("Refactor: one reserve call for the whole order", new HashSet<string> { "batch" }, "refactor"),
    };
    // name, assumed cost units, gateway kind, mock the calculator, assertion kind
    static readonly (string name, int cost, string gw, bool mockCalc, string assertion)[] Styles =
    {
        ("Stubs, assert the result", 2, "stub", false, "result"),
        ("Strict mocks, assert the calls", 4, "mock", false, "calls"),
        ("Mock everything, calculator too", 4, "mock", true, "calls"),
        ("Fakes, assert the state", 6, "fake", false, "state"),
        ("Fakes plus a contract test", 86, "fake", false, "state"), // the contract test runs the real sandbox gateway: 40 units per test
    };

    class Gateway
    {
        public string Kind; public bool Decline; public List<string> Calls = new(); public List<int> Charged = new();
        public Gateway(string kind, bool decline) { Kind = kind; Decline = decline; }
        public bool Charge(object cur, object amt, string key)
        {
            Calls.Add($"{cur}:{amt}");
            if (Kind == "stub" || Kind == "mock") return !Decline;           // canned answer
            if (!(cur is string s && s == "USD")) return false;               // fake and real both validate
            if (!(amt is int a && a > 0)) return false;
            if (Kind == "real" && key == "") return false;                    // only the real one knows about keys
            if (a > (Decline ? 1000 : 100000)) return false;
            Charged.Add(a);
            return true;
        }
    }

    class Inventory
    {
        public Dictionary<string, int> Stock = new() { ["pen"] = 10, ["book"] = 5 };
        public List<string> Calls = new();
        public bool Reserve(string sku, int qty)
        {
            Calls.Add($"reserve {sku} {qty}");
            if (Stock[sku] < qty) return false;
            Stock[sku] -= qty; return true;
        }
        public void ReserveAll((string sku, int qty)[] items) { Calls.Add("reserveAll"); foreach (var (sku, qty) in items) Stock[sku] -= qty; }
        public void Release(string sku, int qty) { Calls.Add($"release {sku} {qty}"); Stock[sku] += qty; }
        public int Lookup(string sku) { Calls.Add($"stock {sku}"); return Stock[sku]; }
    }

    static int Calculator(bool twice) => Order.Sum(l => l.price * l.qty) * (twice ? 2 : 1);

    static string Place(Gateway gw, Inventory inv, bool mockCalc, HashSet<string> cfg) // the code under test
    {
        int total = mockCalc ? 2599 : Calculator(cfg.Contains("twice")); // the "mock everything" style replaces even the calculator
        int amount = cfg.Contains("dollars") ? total / 100 : total;
        if (cfg.Contains("extraLookup")) foreach (var l in Order) inv.Lookup(l.sku);
        if (cfg.Contains("batch")) inv.ReserveAll(Order.Select(l => (l.sku, l.qty)).ToArray());
        else foreach (var l in Order) inv.Reserve(l.sku, l.qty);
        string key = cfg.Contains("noKey") ? "" : "order-1";
        int[] charges = cfg.Contains("perLine") ? Order.Select(l => l.price * l.qty).ToArray() : new[] { amount };
        foreach (int a in charges)
        {
            bool ok = cfg.Contains("swap") ? gw.Charge(a, "USD", key) : gw.Charge("USD", a, key);
            if (!ok)
            {
                if (!cfg.Contains("noRelease")) foreach (var l in Order) inv.Release(l.sku, l.qty);
                return "declined";
            }
        }
        return "ok";
    }

    // One test: place an order (or one that the gateway declines) and assert what the style asserts. True when it passes.
    static bool RunTest(int styleIndex, string gwKind, HashSet<string> cfg, bool declines)
    {
        var style = Styles[styleIndex];
        var gw = new Gateway(gwKind, declines); var inv = new Inventory();
        string result = Place(gw, inv, style.mockCalc, cfg);
        if (result != (declines ? "declined" : "ok")) return false;
        if (style.assertion == "result") return true;
        if (style.assertion == "calls")
        {
            var want = new List<string> { "reserve pen 4", "reserve book 1" };
            if (declines) { want.Add("release pen 4"); want.Add("release book 1"); }
            return string.Join(",", gw.Calls) == "USD:2599" && string.Join(",", inv.Calls) == string.Join(",", want);
        }
        bool stockOk = declines ? inv.Stock["pen"] == 10 && inv.Stock["book"] == 5 : inv.Stock["pen"] == 6 && inv.Stock["book"] == 4;
        return string.Join(",", gw.Charged) == (declines ? "" : "2599") && stockOk;
    }

    static bool Fails(int styleIndex, HashSet<string> cfg)
    {
        var style = Styles[styleIndex];
        bool failed = new[] { false, true }.Any(d => !RunTest(styleIndex, style.gw, cfg, d));
        if (style.name.Contains("contract")) failed = failed || new[] { false, true }.Any(d => !RunTest(styleIndex, "real", cfg, d));
        return failed;
    }

    public static void Main()
    {
        for (int s = 0; s < Styles.Length; s++)
        {
            bool healthy = !Fails(s, Configs[0].flags);
            var bugs = Configs.Where(c => c.kind == "bug").ToList();
            var refactors = Configs.Where(c => c.kind == "refactor").ToList();
            int caught = bugs.Count(c => Fails(s, c.flags)), broken = refactors.Count(c => Fails(s, c.flags));
            Console.WriteLine($"{Styles[s].name}: healthy passes {healthy.ToString().ToLower()}, bugs caught {caught}/{bugs.Count}, refactors that break tests {broken}/{refactors.Count}, cost {Styles[s].cost}");
            var missed = bugs.Where(c => !Fails(s, c.flags)).Select(c => c.name).ToList();
            Console.WriteLine($"  green but wrong in production: {(missed.Count > 0 ? string.Join("; ", missed) : "none")}");
        }
    }
}
