// Charging a card exactly once in C#:
// an idempotency key makes retries safe, and every successful charge is recorded as two balanced ledger entries.
using System;
using System.Collections.Generic;
using System.Linq;

public class TimeoutException2 : Exception { }

public record Charge(string Id, long AmountCents);
public record Entry(string Payment, string Account, long Debit, long Credit);

public class Payment
{
    public string Id = "";
    public string State = "processing";
    public long AmountCents;
    public string? ChargeId;
}

// A pretend payment provider. Like real ones it remembers the key of each charge, and its reply can be lost after the money moved.
public class Provider
{
    public readonly Dictionary<string, Charge> Charges = new();
    bool loseNextReply = true;

    public Charge Charge(string key, long amountCents)
    {
        if (!Charges.ContainsKey(key)) Charges[key] = new Charge($"ch_{Charges.Count + 1}", amountCents);
        if (loseNextReply) { loseNextReply = false; throw new TimeoutException2(); } // the charge happened, the answer did not arrive
        return Charges[key];
    }
}

public class PaymentService
{
    const int MaxAttempts = 3; // calls to the provider before the payment is marked unknown
    readonly Provider provider;
    public readonly Dictionary<string, Payment> Payments = new();
    public readonly List<Entry> Ledger = new();

    public PaymentService(Provider provider) { this.provider = provider; }

    public Payment Pay(string key, long amountCents)
    {
        Payments.TryGetValue(key, out var existing);
        if (existing != null && existing.State == "succeeded") return existing; // a repeat of a finished request: same answer, no new charge
        var payment = existing ?? new Payment { Id = $"pay_{Payments.Count + 1}", AmountCents = amountCents };
        Payments[key] = payment; // saved BEFORE calling the provider, so a crash leaves a trace
        for (int attempt = 1; attempt <= MaxAttempts; attempt++)
        {
            try
            {
                var charge = provider.Charge(key, amountCents); // the same key on every attempt
                payment.State = "succeeded";
                payment.ChargeId = charge.Id;
                Post(payment); // two entries that cancel out, written together
                return payment;
            }
            catch (TimeoutException2) { } // only a timeout is worth retrying; anything else is a real failure and propagates
        }
        payment.State = "unknown"; // never guess: a webhook or a status check settles it later
        return payment;
    }

    void Post(Payment p)
    {
        Ledger.Add(new Entry(p.Id, "provider_receivable", p.AmountCents, 0));
        Ledger.Add(new Entry(p.Id, "revenue", 0, p.AmountCents));
    }
}

public static class Program
{
    public static int Main()
    {
        const int Requests = 3; // the same request arrives three times
        var provider = new Provider();
        var service = new PaymentService(provider);

        // The shopper's browser sends the same request three times (a timeout, then two double-clicks) with one key.
        var results = Enumerable.Range(1, Requests).Select(_ => service.Pay("order-81-attempt-1", 2599)).ToList();

        long debits = service.Ledger.Sum(e => e.Debit);
        long credits = service.Ledger.Sum(e => e.Credit);
        Console.WriteLine($"requests: 3   payments created: {service.Payments.Count}   provider charges: {provider.Charges.Count}");
        Console.WriteLine($"results: {string.Join(", ", results.Select(r => $"{r.Id} {r.State}"))}");
        Console.WriteLine($"ledger entries: {service.Ledger.Count}   debits {debits}   credits {credits}");
        return provider.Charges.Count != 1 || service.Payments.Count != 1 || service.Ledger.Count != 2 || debits != credits ? 1 : 0;
    }
}
