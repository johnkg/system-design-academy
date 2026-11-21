// Dependency inversion: an order service that builds its own SMTP mailer and database, against one that OWNS the
// abstractions it needs and receives implementations. Part 1 runs both for real and counts calls that would leave the
// process. Part 2 is a small model of four codebases: it counts what a change touches. Look for: the high-level files
// touched when the mail provider is swapped, and how many tests need real infrastructure.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    public static int RealCalls = 0; // every call to SMTP or SQL

    public static void Main()
    {
        var order = new Order(7, 2, "a@x.io");
        Console.WriteLine($"hard-wired test: {new HardOrderService().Place(order)}, real calls {RealCalls}");
        RealCalls = 0;
        var notifier = new FakeNotifier(); var store = new FakeStore();
        Console.WriteLine($"owned abstraction, fakes: {new OrderService(notifier, store).Place(order)}, real calls {RealCalls}, saved {store.Saved}, sent \"{notifier.Sent[0]}\"");
        Console.WriteLine($"production wiring: {new OrderService(new SmtpMailer(), new SqlDatabase()).Place(order)}, real calls {RealCalls}");

        string[] services = { "OrderService", "InvoiceService", "ReminderService" };
        var hard = new List<F> { new("Program", "root", services, 0), new("OrderService", "policy", new[] { "SmtpMailer", "SqlDatabase" }, 4, "", true),
            new("InvoiceService", "policy", new[] { "SmtpMailer", "SqlDatabase" }, 3), new("ReminderService", "policy", new[] { "SmtpMailer" }, 2),
            new("SmtpMailer", "infra", new string[0], 1), new("SqlDatabase", "infra", new string[0], 1) };
        var concrete = new List<F> { new("Program", "root", services.Concat(new[] { "SmtpMailer", "SqlDatabase" }).ToArray(), 0) }.Concat(hard.Skip(1)).ToList(); // same files, but handed in
        var owned = new List<F> { concrete[0], new("OrderService", "policy", new[] { "Notifier", "OrderStore" }, 4, "", true), new("InvoiceService", "policy", new[] { "Notifier", "OrderStore" }, 3),
            new("ReminderService", "policy", new[] { "Notifier" }, 2), new("Notifier", "interface", new string[0], 0), new("OrderStore", "interface", new string[0], 0),
            new("SmtpMailer", "infra", new string[0], 1, "Notifier"), new("SqlDatabase", "infra", new string[0], 1, "OrderStore") };
        var everything = new List<F> { new("Program", "root", services.Concat(new[] { "SmtpMailer", "SqlDatabase", "SystemClock", "OrderValidator", "PriceCalculator", "Money" }).ToArray(), 0),
            new("OrderService", "policy", new[] { "Notifier", "OrderStore", "IValidator", "IPriceCalculator", "IClock" }, 4),
            new("InvoiceService", "policy", new[] { "Notifier", "OrderStore", "IMoney", "IClock" }, 3), new("ReminderService", "policy", new[] { "Notifier", "IClock" }, 2) };
        everything.AddRange(owned.Skip(4));
        everything.AddRange(new[] { new F("IClock", "interface", new string[0], 0), new F("SystemClock", "helper", new string[0], 1, "IClock"), new F("IValidator", "interface", new string[0], 0),
            new F("OrderValidator", "helper", new string[0], 1, "IValidator"), new F("IPriceCalculator", "interface", new string[0], 0),
            new F("PriceCalculator", "helper", new[] { "IMoney" }, 2, "IPriceCalculator", true), new F("IMoney", "interface", new string[0], 0), new F("Money", "helper", new string[0], 1, "IMoney") });
        var designs = new[] { ("hard-wired", hard), ("DI of concrete types", concrete), ("owned abstraction", owned), ("interface for everything", everything) };
        var names = new Dictionary<string, string> { ["swap"] = "swap the mail provider", ["test"] = "add one test of OrderService", ["rule"] = "change the high-level rule" };
        foreach (var (label, d) in designs)
        {
            Console.WriteLine($"-- {label}: {d.Count} files, {d.Sum(f => f.Tests)} tests");
            foreach (var kind in new[] { "swap", "test", "rule" })
            {
                var (touched, policy, rerun, infra, layers) = Change(d, kind);
                Console.WriteLine($"  {names[kind]}: touches {touched.Count} ({string.Join(", ", touched)}); policy files {policy}; tests re-run {rerun}; tests needing real infra {infra}; layers {layers}");
            }
        }
    }

    // Part 2: the model. Uses = what a file calls; Impl = the interface a detail implements; Tests = tests whose subject is the file.
    public record F(string Name, string Kind, string[] Uses, int Tests, string Impl = "", bool Rule = false);

    static F? Get(List<F> d, string n) => d.FirstOrDefault(f => f.Name == n);
    static List<string> UsersOf(List<F> d, string n) => d.Where(f => f.Uses.Contains(n)).Select(f => f.Name).ToList();
    static List<string> UsersClosure(List<F> d, List<string> names) // every file that depends, directly or not, on one of names
    {
        var o = names.Distinct().ToList(); var todo = new List<string>(names);
        while (todo.Count > 0)
        {
            var n = todo[^1]; todo.RemoveAt(todo.Count - 1);
            foreach (var u in UsersOf(d, n)) if (!o.Contains(u)) { o.Add(u); todo.Add(u); }
        }
        return o;
    }
    // A test needs real infrastructure when its subject reaches a concrete infra class without passing an interface.
    // (Subclass-mocking a concrete class is possible, but it keeps the test tied to the detail, so it is not counted.)
    static bool ReachesInfra(List<F> d, string n) { var f = Get(d, n)!; return f.Kind == "infra" || (f.Kind != "interface" && f.Uses.Any(u => ReachesInfra(d, u))); }
    // Files a reader opens on the longest call path from OrderService to a target (or to any leaf): an interface leads on to its implementers.
    static int Layers(List<F> d, string n, string[]? targets)
    {
        var f = Get(d, n)!;
        var next = f.Uses.Concat(f.Kind == "interface" ? d.Where(x => x.Impl == n).Select(x => x.Name) : new string[0]).ToList();
        int here = targets == null ? (next.Count > 0 ? 0 : 1) : (targets.Contains(n) ? 1 : 0);
        int best = here;
        foreach (var m in next) { int x = Layers(d, m, targets); if (x > 0) best = Math.Max(best, x + 1); }
        return best;
    }
    static (List<string> touched, int policy, int rerun, int infra, int layers) Change(List<F> d, string kind)
    {
        var after = d; List<string> touched;
        if (kind == "swap") // the new provider has a different API: whoever names the old class directly must change
        {
            touched = new List<string> { "SendGridMailer" }.Concat(UsersOf(d, "SmtpMailer")).ToList();
            after = d.Where(f => f.Name != "SmtpMailer").Select(f => f with { Uses = f.Uses.Select(u => u == "SmtpMailer" ? "SendGridMailer" : u).ToArray() }).ToList();
            after.Add(new F("SendGridMailer", "infra", new string[0], 1, Get(d, "SmtpMailer")!.Impl));
        }
        else if (kind == "test") { touched = new List<string> { "NewOrderServiceTest" }; after = d.Select(f => f.Name == "OrderService" ? f with { Tests = f.Tests + 1 } : f).ToList(); }
        else // the rule needs one more input: across an interface the signature changes too, and so do its callers
        {
            var home = d.First(f => f.Rule);
            var iface = home.Impl != "" ? Get(d, home.Impl) : null;
            touched = new List<string> { home.Name };
            if (iface != null) { touched.Add(iface.Name); touched.AddRange(UsersOf(d, iface.Name)); }
        }
        int rerun = kind == "test" ? 1 : UsersClosure(d, touched.Where(n => Get(d, n) != null).ToList()).Sum(n => Get(d, n)!.Tests) + (kind == "swap" ? 1 : 0);
        string[]? focus = kind == "swap" ? new[] { "SendGridMailer" } : kind == "rule" ? new[] { d.First(f => f.Rule).Name } : null;
        int policy = touched.Count(n => Get(after, n) is { Kind: "policy" });
        int infra = after.Where(f => ReachesInfra(after, f.Name)).Sum(f => f.Tests);
        return (touched, policy, rerun, infra, Layers(after, "OrderService", focus));
    }
}

public record Order(int Id, int Qty, string Email);
public interface INotifier { void Notify(string to, string text); }
public interface IOrderStore { void Save(Order order); }
public class SmtpMailer : INotifier { public void Notify(string to, string text) { Program.RealCalls++; } }
public class SqlDatabase : IOrderStore { public void Save(Order order) { Program.RealCalls++; } }

// Hard-wired: the policy creates its own details.
public class HardOrderService
{
    readonly SmtpMailer mailer = new(); readonly SqlDatabase db = new();
    public string Place(Order o)
    {
        if (o.Qty <= 0) return "rejected";
        db.Save(o);
        mailer.Notify(o.Email, $"order {o.Id} placed");
        return "placed";
    }
}
// Owned abstraction: OrderService states what it needs (Notify, Save) in its own terms; details implement that.
public class OrderService(INotifier notifier, IOrderStore store)
{
    public string Place(Order o)
    {
        if (o.Qty <= 0) return "rejected";
        store.Save(o);
        notifier.Notify(o.Email, $"order {o.Id} placed");
        return "placed";
    }
}
public class FakeNotifier : INotifier { public List<string> Sent = new(); public void Notify(string to, string text) => Sent.Add($"{to}: {text}"); }
public class FakeStore : IOrderStore { public int Saved; public void Save(Order order) => Saved++; }
