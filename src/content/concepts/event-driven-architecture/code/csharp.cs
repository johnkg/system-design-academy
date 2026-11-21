// Event-driven architecture: one "place an order" flow built four ways, with the same order data, the same outage and the same change.
// Look for: messages per order, hops until the customer gets an answer vs until the order is done, who the publisher can name, and orders lost or delayed in an outage.
// A message is (from, to, label, carries_order). A hop is one message that causally follows another (it leaves a service that just received one).
// Assumptions: every hop costs 5 ms; Payments handles 3 orders per tick when it is up; 10 ticks of arrivals; the workflow gives up on an order after 2 ticks of waiting.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const int HopMs = 5, Capacity = 3, ArrivalTicks = 10, OutageStart = 3, Patience = 2;

    record Msg(string From, string To, string Label, bool Carries);
    record Design(string Name, List<Msg> Msgs, bool Waits, bool Named, string Driver, string[] Flow, string[] FraudEdit, string[] FraudReview, string Outage);

    static string[] S(params string[] x) => x;

    static List<Msg> Direct() // the order service calls each service in turn and waits for each reply
    {
        var m = new List<Msg>();
        foreach (var s in S("Payments", "Inventory", "Shipping", "Notify", "Analytics")) { m.Add(new("Orders", s, "call", true)); m.Add(new(s, "Orders", "reply", false)); }
        return m;
    }

    static List<Msg> Orchestrated() // one workflow service sends the commands and waits for the replies
    {
        var m = new List<Msg> { new("Orders", "Workflow", "start", true) };
        foreach (var s in S("Payments", "Inventory", "Shipping", "Notify", "Analytics")) { m.Add(new("Workflow", s, "command", true)); m.Add(new(s, "Workflow", "reply", false)); }
        m.Add(new("Workflow", "Orders", "done", false));
        return m;
    }

    static List<Msg> Choreography() => new() // each service publishes what happened, and others react
    {
        new("Orders", "Payments", "OrderPlaced", true), new("Orders", "Analytics", "OrderPlaced", true), new("Orders", "Notify", "OrderPlaced", true),
        new("Payments", "Inventory", "PaymentTaken", true), new("Payments", "Analytics", "PaymentTaken", true),
        new("Inventory", "Shipping", "StockReserved", true),
        new("Shipping", "Notify", "Shipped", true), new("Shipping", "Analytics", "Shipped", true),
    };

    static List<Msg> EverythingAnEvent() // every step announces that it started and finished, and an audit service listens to all
    {
        var m = new List<Msg>();
        foreach (var s in S("Payments", "Analytics", "Audit", "Notify")) m.Add(new("Orders", s, "OrderPlaced", true));
        var chain = S("Payments", "Inventory", "Shipping", "Notify");
        for (int i = 0; i < chain.Length; i++)
        {
            var s = chain[i];
            foreach (var w in S("Analytics", "Audit")) m.Add(new(s, w, "Started", false));
            var next = i + 1 < chain.Length ? new[] { chain[i + 1] } : new string[] { };
            foreach (var w in next.Concat(S("Analytics", "Audit"))) m.Add(new(s, w, "Done", true));
        }
        return m;
    }

    static readonly Design[] Designs =
    {
        new("Direct calls", Direct(), true, true, "Orders", S("Orders"), S("Orders"), S(), "fail"),
        new("Orchestrated commands", Orchestrated(), true, true, "Workflow", S("Workflow"), S("Workflow"), S(), "patient"),
        new("Choreographed events", Choreography(), false, false, "Orders", S("Orders", "Payments", "Inventory", "Shipping", "Notify", "Analytics"), S("Payments"), S("Analytics", "Notify"), "queue"),
        new("Everything an event", EverythingAnEvent(), false, false, "Orders", S("Orders", "Payments", "Inventory", "Shipping", "Notify", "Analytics", "Audit"), S("Payments"), S("Analytics", "Audit", "Notify"), "queue"),
    };

    static int Depth(List<Msg> msgs) // longest causal chain: a message follows an earlier one that arrived at its sender
    {
        var d = new int[msgs.Count];
        for (int j = 0; j < msgs.Count; j++)
        {
            d[j] = 1;
            for (int i = 0; i < j; i++) if (msgs[i].To == msgs[j].From) d[j] = Math.Max(d[j], d[i] + 1);
        }
        return d.Max();
    }

    static (int, int, int, int, int) Outage(string mode, int rate, int down) // orders arrive for ArrivalTicks ticks; Payments is down for `down` ticks from OutageStart
    {
        bool IsDown(int t) => t >= OutageStart && t < OutageStart + down;
        var queue = new List<int>();
        int failed = 0, done = 0, high = 0, last = 0, maxWait = 0;
        for (int t = 0; t < 40; t++)
        {
            int arrivals = t < ArrivalTicks ? rate : 0;
            for (int k = 0; k < arrivals; k++)
            {
                if (mode == "fail" && IsDown(t)) failed++;
                else if (mode == "fail") { done++; last = Math.Max(last, t); }
                else queue.Add(t);
            }
            if (mode == "patient")
            {
                var keep = queue.Where(a => t - a <= Patience).ToList();
                failed += queue.Count - keep.Count;
                queue = keep;
            }
            if (mode != "fail" && !IsDown(t))
            {
                int n = Math.Min(Capacity, queue.Count);
                foreach (var a in queue.Take(n)) { done++; maxWait = Math.Max(maxWait, t - a); last = Math.Max(last, t); }
                queue = queue.Skip(n).ToList();
            }
            high = Math.Max(high, queue.Count);
        }
        return (failed, done, high, maxWait, last);
    }

    public static void Main()
    {
        foreach (var d in Designs)
        {
            int hops = Depth(d.Msgs);
            int resp = d.Waits ? hops : 1;
            var carriers = new HashSet<string>();
            foreach (var m in d.Msgs.Where(m => m.Carries)) { carriers.Add(m.From); carriers.Add(m.To); }
            int named = d.Named ? d.Msgs.Where(m => m.Carries && m.From == d.Driver).Select(m => m.To).Distinct().Count() : 0;
            Console.WriteLine($"== {d.Name}: messages per order {d.Msgs.Count}; hops until the customer is answered {resp} ({resp * HopMs} ms); hops until the order is done {hops} ({hops * HopMs} ms)");
            Console.WriteLine($"  places that define the flow {d.Flow.Length}; services edited to add a field to the order {carriers.Count}; consumers the publisher's own code names {named}");
            Console.WriteLine($"  add a fraud check: files edited {d.FraudEdit.Length}, new files 1, subscribers to review {d.FraudReview.Length}");
            foreach (var (rate, down) in new[] { (2, 4), (3, 8) })
            {
                var (failed, done, high, wait, last) = Outage(d.Outage, rate, down);
                Console.WriteLine($"  Payments down {down} ticks at {rate} orders per tick: failed {failed}, done {done}, queue high-water {high}, longest wait {wait} ticks, last done at tick {last}");
            }
        }
    }
}
