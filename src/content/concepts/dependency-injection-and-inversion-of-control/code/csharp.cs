// Dependency injection: an order service that charges a card, sends an email and reads the clock, built four ways.
// A shared "world" counts how many REAL side effects were reached; a good test reaches none.
// Look for: what a test can replace, what happens when a test forgets one fake, and what adding a fourth dependency
// costs. A missing dependency is reported when the object is built; in a compiled language this would be a compile
// error for constructor injection, here it is an explicit check at construction time.
using System;
using System.Collections.Generic;

public static class Program
{
    static int charges, mails, clockReads;
    static void Reset() { charges = 0; mails = 0; clockReads = 0; }

    interface IGateway { void Charge(int amount); }
    interface IMailer { void Send(string to); }
    interface IClock { int Now(); }
    class RealGateway : IGateway { public void Charge(int a) { charges++; } }
    class RealMailer : IMailer { public void Send(string to) { mails++; } }
    class RealClock : IClock { public int Now() { clockReads++; return 1; } }
    class FakeGateway : IGateway { public void Charge(int a) { } }
    class FakeMailer : IMailer { public void Send(string to) { } }
    class FakeClock : IClock { public int Now() => 1; }

    static Dictionary<string, object> Real() => new() { ["gateway"] = new RealGateway(), ["mailer"] = new RealMailer(), ["clock"] = new RealClock() };
    static Dictionary<string, object> Fake() => new() { ["gateway"] = new FakeGateway(), ["mailer"] = new FakeMailer(), ["clock"] = new FakeClock() };
    static void Run(Dictionary<string, object> d) { ((IGateway)d["gateway"]).Charge(50); ((IMailer)d["mailer"]).Send("a@example.com"); ((IClock)d["clock"]).Now(); }
    static void Need(Dictionary<string, object> deps, IEnumerable<string> names) { foreach (var n in names) if (!deps.ContainsKey(n)) throw new Exception($"missing {n}"); }

    interface IOrders { void Checkout(); }
    class Hardcoded : IOrders { public void Checkout() => Run(Real()); } // builds its own collaborators: nothing can be replaced
    class Injected : IOrders // constructor injection: the three needs are the constructor parameters
    {
        readonly Dictionary<string, object> d;
        public Injected(Dictionary<string, object> deps) { Need(deps, new[] { "gateway", "mailer", "clock" }); d = deps; }
        public void Checkout() => Run(d);
    }
    static Dictionary<string, object> registry = new(); // global registry, filled with the production objects
    static void ResetLocator() { registry = Real(); }
    class Located : IOrders { public void Checkout() => Run(registry); } // asks the global registry: the constructor says nothing
    static readonly string[] Nine = { "gateway", "mailer", "clock", "logger", "ids", "formatter", "rounding", "retry", "metrics" };
    class OverInjected : IOrders // a container wires nine collaborators, six of them trivial helpers a test never replaces
    {
        readonly Dictionary<string, object> d;
        public OverInjected(Dictionary<string, object> deps) { Need(deps, Nine); d = deps; }
        public void Checkout() => Run(d);
    }
    static Dictionary<string, object> NineFakes(string? skip)
    {
        var f = Fake();
        for (int i = 3; i < Nine.Length; i++) f[Nine[i]] = new object();
        if (skip != null) f.Remove(skip);
        return f;
    }
    static Dictionary<string, object> Without(string? skip) { var f = Fake(); if (skip != null) f.Remove(skip); return f; }

    record Design(string Name, int Params, Func<string?, (int Fakes, Func<IOrders> Build)> Make);

    static readonly Design[] Designs =
    {
        new("Built inside (new, or a global)", 0, skip => (0, () => new Hardcoded())),
        new("Constructor injection", 3, skip => (skip != null ? 2 : 3, () => new Injected(Without(skip)))),
        new("Service locator", 0, skip => (skip != null ? 2 : 3, () =>
        {
            ResetLocator();
            foreach (var kv in Without(skip)) registry[kv.Key] = kv.Value;
            if (skip != null) registry[skip] = Real()[skip];
            return new Located();
        })),
        new("Container, everything injected", 9, skip => (skip != null ? 8 : 9, () => new OverInjected(NineFakes(skip)))),
    };

    // Adding a fourth dependency (a tax calculator) with 1 production construction site and 4 existing tests.
    const int Tests = 4;
    static readonly (int Files, int Loud, int Quiet)[] Add =
    {
        (1, 0, Tests),              // nothing to edit but the service; every test now reaches the real calculator
        (1 + 1 + Tests, Tests, 0),  // service, composition root, each test passes one more fake; tests fail to build until then
        (1 + 1, 0, Tests),          // service and one registration; tests keep running against the real calculator
        (4 + Tests, Tests, 0),      // interface, implementation, registration, service, and a fake in each test
    };

    public static void Main()
    {
        for (int i = 0; i < Designs.Length; i++)
        {
            var d = Designs[i];
            Console.WriteLine($"== {d.Name}");
            Reset();
            var t1 = d.Make(null); t1.Build().Checkout();
            Console.WriteLine($"  test a checkout: fakes the test supplies {t1.Fakes}; real effects reached {charges + mails + clockReads} (charges {charges}, emails {mails}, clock reads {clockReads}); dependencies visible in the signature: {d.Params}");
            Reset();
            string outcome = "test ran";
            try { d.Make("mailer").Build().Checkout(); } catch (Exception e) { outcome = $"failed before running: {e.Message}"; }
            Console.WriteLine($"  test forgets the mailer fake: {outcome}; real effects reached {charges + mails + clockReads} (emails {mails})");
            Console.WriteLine($"  add a fourth dependency: files edited {Add[i].Files}; tests that fail loudly {Add[i].Loud}; tests that quietly use the real thing {Add[i].Quiet}");
        }
    }
}
