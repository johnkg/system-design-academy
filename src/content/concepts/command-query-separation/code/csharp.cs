// Command-Query Separation: a cart total and a ticket counter, built three ways.
// Look for: reads that change state (a total that spends a coupon), and the race that appears when a combined
// "read then change" is split into two calls with nothing making them atomic.
// Cart: subtotal 100, a one-time coupon worth 10, so the right total is 90 every time it is read.
// Tickets: the counter starts at 7; two workers each take one ticket at the same moment.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    class MixedCart // Total() reads AND spends the coupon the first time it is called
    {
        public int Coupon = 10;
        public int Total() { int t = 100; if (Coupon > 0) { t -= Coupon; Coupon = 0; } return t; }
    }

    class SeparatedCart // ApplyCoupon() is the command, Total() is a pure query
    {
        int discount = 0;
        public void ApplyCoupon() { discount = 10; }
        public int Total() => 100 - discount;
    }

    class MixedCounter // NextTicket() changes and returns in one step: no other worker can slip in between
    {
        public int N = 7;
        public int NextTicket() => N++;
    }

    class StrictCounter // Peek() is a query, Advance() is a command; taking a ticket needs both calls
    {
        public int N = 7;
        public int Peek() => N;
        public void Advance() { N++; }
    }

    static readonly string[] Designs = { "Mixed everywhere", "Strict separation everywhere", "Separated, with a named atomic exception" };

    // Situation 1 and 2: the page reads the total; situation 2 adds one debug log line that reads it first.
    static (List<int> Page, int Changed, int Distinct, int Wrong) CartRun(int design, int situation)
    {
        int reads = situation == 1 ? 3 : 4;
        var shown = new List<int>();
        int changed = 0;
        if (design == 0)
        {
            var c = new MixedCart();
            for (int i = 0; i < reads; i++) { int before = c.Coupon; shown.Add(c.Total()); if (c.Coupon != before) changed++; }
        }
        else
        {
            var c = new SeparatedCart();
            c.ApplyCoupon(); // one explicit command at checkout
            for (int i = 0; i < reads; i++) shown.Add(c.Total());
        }
        var page = situation == 1 ? shown : shown.Skip(1).ToList(); // the log line is the first read in situation 2
        int wrong = page.Count(v => v != 90); // the right total is 90
        return (page, changed, page.Distinct().Count(), wrong);
    }

    // Situation 3: two workers each take a ticket. Atomic operations run whole; split calls interleave A1 B1 A2 B2.
    static (List<int> Issued, int Counter, int Duplicates, int Skipped, int Calls) TicketRun(int design)
    {
        var issued = new List<int>();
        int counter;
        if (design == 1)
        {
            var c = new StrictCounter();
            int a = c.Peek(); int b = c.Peek(); c.Advance(); c.Advance();
            issued.Add(a); issued.Add(b); counter = c.N;
        }
        else
        {
            var c = new MixedCounter(); // design 0 and design 2 (TakeTicket) behave the same here
            issued.Add(c.NextTicket()); issued.Add(c.NextTicket()); counter = c.N;
        }
        int distinct = issued.Distinct().Count();
        return (issued, counter, issued.Count - distinct, (counter - 7) - distinct, design == 1 ? 2 : 1);
    }

    public static void Main()
    {
        for (int d = 0; d < 3; d++)
        {
            Console.WriteLine($"== {Designs[d]}");
            foreach (int s in new[] { 1, 2 })
            {
                var r = CartRun(d, s);
                Console.WriteLine($"  {(s == 1 ? "page reads total 3 times" : "page plus one debug log read")}: page shows {string.Join(", ", r.Page)}; reads that changed state: {r.Changed}; distinct totals on the page: {r.Distinct}; page reads showing a wrong total: {r.Wrong}");
            }
            var t = TicketRun(d);
            Console.WriteLine($"  two workers take a ticket: issued {string.Join(", ", t.Issued)}; counter ends at {t.Counter}; duplicates: {t.Duplicates}; numbers skipped: {t.Skipped}; calls per ticket: {t.Calls}");
        }
    }
}
