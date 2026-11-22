// Design by contract and defensive programming. An order goes through four layers (api, service, pricing, ledger). The same 20
// requests run through five designs: no checks, check everything everywhere, a contract (validate user input at the boundary,
// one postcondition inside), the same contract with assertions switched off, and silent repair (clamp bad values and go on).
// Every check is counted. 14 requests are fine, 4 carry bad user input (a quantity outside 1..100) and 2 hit a bug in our own
// service (a legacy path multiplies the price by 100 by mistake). Look for: where each design catches things, how many
// checks it pays for, and which designs let a wrong record through. Part 2 runs the same model on 100 requests.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const int Limit = 100000;
    static readonly string[] Layers = { "api", "service", "pricing", "ledger" };
    static int checks = 0;
    static int Clamp(int x, int lo, int hi) => Math.Min(Math.Max(x, lo), hi);

    static bool Check(bool ok) // every condition a design evaluates goes through here, so the cost is visible
    {
        checks += 1;
        return ok;
    }
    static bool ValidAll(int qty, int price) => // three conditions, stops at the first one that fails
        Check(qty >= 1 && qty <= 100) && Check(price >= 0 && price <= 10000) && Check(qty * price >= 0 && qty * price <= Limit);
    static (int, int) ClampAll(int qty, int price) // three "checks" that repair instead of rejecting
    {
        checks += 3;
        return (Clamp(qty, 1, 100), Clamp(price, 0, 10000));
    }

    static (string, int) Api(string design, int qty, int price, bool legacy, bool internals)
    {
        if (design == "everywhere" && !ValidAll(qty, price)) return ("error", Idx("api"));
        if (design == "contract") // precondition on user input: the caller (the outside world) must supply a sane order
        {
            if (!(Check(qty >= 1 && qty <= 100) && Check(price >= 0 && price <= 10000))) return ("error", Idx("api"));
        }
        if (design == "repair") (qty, price) = ClampAll(qty, price);
        return Service(design, qty, price, legacy, internals);
    }
    static (string, int) Service(string design, int qty, int price, bool legacy, bool internals)
    {
        if (design == "everywhere" && !ValidAll(qty, price)) return ("error", Idx("service"));
        if (design == "repair") (qty, price) = ClampAll(qty, price);
        if (legacy) price = price * 100; // the bug: the legacy path mixes up units
        return Pricing(design, qty, price, internals);
    }
    static (string, int) Pricing(string design, int qty, int price, bool internals)
    {
        if (design == "everywhere" && !ValidAll(qty, price)) return ("error", Idx("pricing"));
        if (design == "repair")
        {
            checks += 3;
            qty = Clamp(qty, 1, 100);
            price = Clamp(price, 0, 10000);
            return Ledger(design, Clamp(qty * price, 0, Limit), qty, price);
        }
        int total = qty * price;
        if (design == "contract" && internals && !Check(total >= 0 && total <= Limit)) return ("error", Idx("pricing")); // postcondition of pricing
        return Ledger(design, total, qty, price);
    }
    static (string, int) Ledger(string design, int total, int qty, int price)
    {
        if (design == "everywhere" && !ValidAll(qty, price)) return ("error", Idx("ledger"));
        if (design == "repair") ClampAll(qty, price);
        return ("record", total);
    }
    static int Idx(string layer) => Array.IndexOf(Layers, layer); // an error carries the index of the layer that stopped it

    static (int, int, int, int, int) Model(string design, int u, int b, bool internals, int n = 100)
    {
        int user = n * u / 100, bug = n * b / 100, ok = n - user - bug;
        if (design == "trust") return (ok, 0, 0, user + bug, 0);
        if (design == "everywhere") return (ok, user, bug, 0, ok * 12 + user + bug * 8);
        if (design == "contract" && internals) return (ok, user, bug, 0, ok * 3 + user + bug * 3);
        if (design == "contract") return (ok, user, 0, bug, ok * 2 + user + bug * 2);
        return (ok, 0, 0, user + bug, n * 12);
    }

    public static void Main()
    {
        var requests = new List<(int, int, bool, string)>();
        foreach (var (q, p) in new[] { (2, 300), (1, 1500), (10, 250), (5, 999), (3, 4500), (40, 120), (7, 700), (12, 800), (1, 10000), (25, 400), (100, 1000),
            (6, 350), (8, 2200), (15, 640) }) requests.Add((q, p, false, "ok"));
        foreach (var (q, p) in new[] { (0, 200), (-3, 500), (500, 20), (101, 50) }) requests.Add((q, p, false, "user"));
        foreach (var (q, p) in new[] { (20, 150), (5, 400) }) requests.Add((q, p, true, "bug"));

        var designs = new (string, string, bool)[] { ("trust", "trust", true), ("everywhere", "everywhere", true), ("contract", "contract", true),
            ("contract, assertions off", "contract", false), ("repair", "repair", true) };
        var real = new Dictionary<string, string>();
        foreach (var (label, design, internals) in designs)
        {
            checks = 0;
            int correct = 0, rejected = 0, loud = 0, wrong = 0;
            var where = new int[4];
            foreach (var (qty, price, legacy, kind) in requests)
            {
                int? expected = kind == "user" ? null : qty * price;
                var res = Api(design, qty, price, legacy, internals);
                if (res.Item1 == "record")
                {
                    if (res.Item2 == expected) correct++; else wrong++;
                }
                else
                {
                    if (expected == null) rejected++; else loud++;
                    where[res.Item2]++;
                }
            }
            real[label] = $"{correct},{rejected},{loud},{wrong},{checks}";
            var stops = string.Join(", ", Enumerable.Range(0, 4).Where(i => where[i] > 0).Select(i => $"{Layers[i]} {where[i]}"));
            Console.WriteLine($"{label}: correct {correct}, rejected {rejected}, failed loudly {loud}, wrong {wrong}, checks {checks}, " +
                $"stopped at: {(stops == "" ? "nowhere" : stops)}");
        }

        bool same = designs.All(d =>
        {
            var r = Model(d.Item2, 20, 10, d.Item3, 20);
            return $"{r.Item1},{r.Item2},{r.Item3},{r.Item4},{r.Item5}" == real[d.Item1];
        });
        Console.WriteLine($"the model gives the same counts as the run: {same.ToString().ToLower()}");
        foreach (var (u, b) in new[] { (0, 0), (20, 10), (40, 20) })
            foreach (var (label, design, internals) in designs)
            {
                var r = Model(design, u, b, internals);
                Console.WriteLine($"{u}% bad input, {b}% bugs, {label}: correct {r.Item1}, wrong {r.Item4}, checks {r.Item5}");
            }
    }
}
