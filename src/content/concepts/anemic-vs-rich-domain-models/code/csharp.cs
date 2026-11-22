// Anemic vs rich domain models: an Order with four rules (ship only when paid, ship only when not empty, no items added
// after shipping, discount at most 50%), built three ways. Five code paths each try all four forbidden changes (20 attempts).
// Three paths go through the OrderService (checkout, REST controller, nightly job); two write fields directly (support
// admin tool, CSV import job). Look for: how many forbidden changes get in, how many places a new rule must be written,
// and what a plain lookup table (Country) costs when it is given the same treatment as the Order.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    static readonly string[] Forbidden = { "ship an unpaid order", "ship an empty order", "add an item to a shipped order", "give an 80% discount" };
    record Caller(string Name, bool Direct);
    static readonly Caller[] Callers =
    {
        new("Checkout service", false), new("REST controller", false), new("Support admin tool", true),
        new("CSV import job", true), new("Nightly job", false),
    };

    class AnemicOrder { public List<string> Items = new(); public bool Paid, Shipped; public int Discount; } // fields only

    class OrderService // the rules live in the service
    {
        public void AddItem(AnemicOrder o, string i) { if (o.Shipped) throw new Exception("shipped"); o.Items.Add(i); }
        public void Pay(AnemicOrder o) { o.Paid = true; }
        public void Ship(AnemicOrder o) { if (!o.Paid) throw new Exception("unpaid"); if (o.Items.Count == 0) throw new Exception("empty"); o.Shipped = true; }
        public void ApplyDiscount(AnemicOrder o, int p) { if (p > 50) throw new Exception("too high"); o.Discount = p; }
    }

    class RichOrder // the rules live in the object, and the fields are only reachable through its methods
    {
        readonly List<string> items = new(); bool paid, shipped; int discount;
        public void AddItem(string i) { if (shipped) throw new Exception("shipped"); items.Add(i); }
        public void Pay() { paid = true; }
        public void Ship() { if (!paid) throw new Exception("unpaid"); if (items.Count == 0) throw new Exception("empty"); shipped = true; }
        public void ApplyDiscount(int p) { if (p > 50) throw new Exception("too high"); discount = p; }
    }

    class Stub { public void Write() { } public void Send() { } }

    class EverywhereOrder : RichOrder // rich everywhere: persistence and email are behaviour of the entity too
    {
        readonly Stub db, mailer;
        public EverywhereOrder(Stub? db, Stub? mailer) { if (db == null || mailer == null) throw new Exception("needs a database and a mailer"); this.db = db; this.mailer = mailer; }
        public void Save() => db.Write();
        public void EmailReceipt() => mailer.Send();
        public string RenderInvoice() => "html";
    }

    static readonly OrderService Svc = new();

    // An order in the state a given forbidden change needs, built only through legal operations.
    static AnemicOrder AnemicOf(int k)
    {
        var o = new AnemicOrder();
        if (k != 1) Svc.AddItem(o, "a");
        if (k != 0) Svc.Pay(o);
        if (k == 2) Svc.Ship(o);
        return o;
    }

    static RichOrder RichOf(int k, Func<RichOrder> make)
    {
        var o = make();
        if (k != 1) o.AddItem("a");
        if (k != 0) o.Pay();
        if (k == 2) o.Ship();
        return o;
    }

    static bool Attempt(int design, Caller caller, int k) // true when the forbidden change got in
    {
        try
        {
            if (design == 0)
            {
                var o = AnemicOf(k);
                if (!caller.Direct) { if (k < 2) Svc.Ship(o); else if (k == 2) Svc.AddItem(o, "b"); else Svc.ApplyDiscount(o, 80); }
                else if (k < 2) o.Shipped = true; else if (k == 2) o.Items.Add("b"); else o.Discount = 80;
            }
            else
            {
                var o = RichOf(k, design == 1 ? () => new RichOrder() : () => new EverywhereOrder(new Stub(), new Stub()));
                if (k < 2) o.Ship(); else if (k == 2) o.AddItem("b"); else o.ApplyDiscount(80);
            }
            return true;
        }
        catch (Exception) { return false; }
    }

    record Design(string Name, Func<List<string>> Where, int Methods, string Note, int Needs);

    static readonly Design[] Designs =
    {
        new("Anemic: fields plus a service", () => new List<string> { "OrderService" }.Concat(Callers.Where(c => c.Direct).Select(c => c.Name)).ToList(),
            2, "Country (2 fields) and a repository with find and save", 0),
        new("Rich where rules exist", () => new List<string> { "Order" },
            2, "Country (2 fields) and a repository with find and save: nothing to protect, so nothing added", 0),
        new("Rich everywhere", () => new List<string> { "Order" },
            8, "Country with validate, rename, equals, display, save and load on top of find and save", 2),
    };

    public static void Main()
    {
        for (int d = 0; d < Designs.Length; d++)
        {
            var D = Designs[d];
            int accepted = 0; var through = new List<string>();
            foreach (var c in Callers)
                for (int k = 0; k < Forbidden.Length; k++)
                    if (Attempt(d, c, k)) { accepted++; if (!through.Contains(c.Name)) through.Add(c.Name); }
            Console.WriteLine($"== {D.Name}");
            Console.WriteLine($"  forbidden changes accepted: {accepted} of {Callers.Length * Forbidden.Length}{(accepted > 0 ? $" (got in through: {string.Join(", ", through)})" : "")}");
            Console.WriteLine($"  new rule \"no discount on a shipped order\": places to write it {D.Where().Count} ({string.Join(", ", D.Where())})");
            Console.WriteLine($"  collaborators needed to test one rule: {D.Needs}");
            Console.WriteLine($"  plain lookup table (Country): methods written {D.Methods}, rules protected 0 ({D.Note})");
        }
    }
}
