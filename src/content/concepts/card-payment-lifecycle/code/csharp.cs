// The life of one card payment: authorize (a hold), capture (the charge, maybe partial), void, expiry, settlement, refund.
// Integer cents and whole days, a fixed script, so the output never changes. Fees and delays are illustrative settings.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const long OpeningAvailable = 50000; // the cardholder's available balance before the order, in cents
    const int ExpiryDays = 7;            // an uncaptured hold is released after this many days
    const int SettleDays = 2;            // captured money reaches the merchant this many days after the capture
    const long FeeBp = 290;              // merchant fee: 2.90% of each capture, in basis points ...
    const long FeeFixed = 30;            // ... plus 30 cents per capture

    static long DivRoundUp(long num, long den) // half up, integers only
    {
        long q = num / den;
        return 2 * (num - q * den) >= den ? q + 1 : q;
    }

    class Payment
    {
        public int Day = 0;
        public long Available = OpeningAvailable, Held, Captured, Refunded, Fees, Pending, Settled;
        public int AuthDay = -1, EndedDay = -1;
        public string Ended = "";
        public List<long[]> Due = new(); // [day, net] of captured money still on its way to the merchant

        static (bool, string) Reject(string reason) => (false, "rejected: " + reason);

        public (bool, string) Authorize(long amount)
        {
            if (AuthDay >= 0) return Reject("an authorization already exists for this order");
            if (Available < amount) return Reject($"the card has {Available} available, {amount} needed");
            Available -= amount; Held = amount; AuthDay = Day;
            return (true, $"hold of {amount} placed, nothing charged yet");
        }

        public (bool, string) Capture(long amount)
        {
            if (AuthDay < 0) return Reject("there is no authorization to capture");
            if (Ended == "expired") return Reject($"the hold expired on day {EndedDay}");
            if (Ended == "voided") return Reject($"the authorization was voided on day {EndedDay}");
            if (amount > Held) return Reject($"capture of {amount} is above the {Held} still held");
            long fee = DivRoundUp(amount * FeeBp, 10000) + FeeFixed;
            Held -= amount; Captured += amount; Fees += fee; Pending += amount - fee;
            Due.Add(new long[] { Day + SettleDays, amount - fee });
            return (true, $"captured {amount}, fee {fee}, merchant will receive {amount - fee} on day {Day + SettleDays}");
        }

        public (bool, string) Void()
        {
            if (Held == 0) return Reject("there is no hold left to release");
            long released = Held;
            Available += released; Held = 0; Ended = "voided"; EndedDay = Day;
            return (true, $"released the hold of {released}");
        }

        public (bool, string) Refund(long amount)
        {
            long left = Captured - Refunded;
            if (amount > left) return Reject($"refund of {amount} is above the {left} captured and not yet refunded");
            Refunded += amount; Available += amount;
            return (true, $"refunded {amount} to the cardholder");
        }

        public (bool, string) Advance()
        {
            Day += 1;
            var notes = new List<string>();
            foreach (var d in Due)
            {
                if (d[1] > 0 && d[0] <= Day)
                {
                    Pending -= d[1]; Settled += d[1];
                    notes.Add($"settled {d[1]} to the merchant");
                    d[1] = 0;
                }
            }
            if (Held > 0 && Day - AuthDay >= ExpiryDays)
            {
                Available += Held;
                notes.Add($"hold expired, {Held} released");
                Held = 0; Ended = "expired"; EndedDay = Day;
            }
            return (true, $"day {Day}" + (notes.Count > 0 ? ": " + string.Join("; ", notes) : ""));
        }

        public string Show() =>
            $"  available {Available}, held {Held}, captured {Captured}, refunded {Refunded}, fees {Fees}, merchant pending {Pending}, settled {Settled}";
    }

    static void Story(string title, List<(string Label, Func<Payment, (bool, string)> Fn)> steps)
    {
        Console.WriteLine($"-- {title}");
        var p = new Payment();
        foreach (var (label, fn) in steps)
        {
            var (_, text) = fn(p);
            Console.WriteLine($"day {p.Day} {label}: {text}");
        }
        Console.WriteLine(p.Show());
    }

    public static void Main()
    {
        Story("authorize, capture in full, settle, refund", new()
        {
            ("authorize 10000", p => p.Authorize(10000)),
            ("advance", p => p.Advance()),
            ("capture 10000", p => p.Capture(10000)),
            ("advance", p => p.Advance()),
            ("advance", p => p.Advance()),
            ("refund 2500", p => p.Refund(2500)),
            ("refund 10000", p => p.Refund(10000)),
        });

        var partial = new List<(string, Func<Payment, (bool, string)>)>
        {
            ("authorize 10000", p => p.Authorize(10000)),
            ("capture 4000", p => p.Capture(4000)),
        };
        for (int i = 0; i < ExpiryDays; i++) partial.Add(("advance", p => p.Advance()));
        partial.Add(("capture 6000", p => p.Capture(6000)));
        Story("partial capture, then the rest of the hold expires", partial);

        Story("void an authorization", new()
        {
            ("authorize 10000", p => p.Authorize(10000)),
            ("void", p => p.Void()),
            ("capture 10000", p => p.Capture(10000)),
            ("void", p => p.Void()),
        });
    }
}
