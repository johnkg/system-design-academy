// Double-entry bookkeeping: an immutable journal of balanced entries, balances derived from it, corrections as reversals.
// A second design keeps one mutable balance column per account, to show what it loses. Amounts are integer cents.
// An amount on a line is signed: positive is a debit, negative is a credit. A valid entry sums to zero.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    static readonly string[] Accounts = { "cash_at_bank", "customer_wallet", "merchant_payable", "fees_revenue" };

    record Line(string Account, long Amount);
    record Entry(int Id, string Memo, Line[] Lines, int Reverses);

    class Books
    {
        public List<Entry> Journal = new();  // append only: entries are never edited or deleted
        public Dictionary<string, long> Column = Accounts.ToDictionary(a => a, a => 0L); // the "balance column updated in place" design
        public List<string> Log = new();

        // Journal design: reject an entry whose debits and credits differ, otherwise append it.
        public bool Post(string memo, Line[] lines, int reverses = 0)
        {
            long debits = lines.Where(l => l.Amount > 0).Sum(l => l.Amount);
            long credits = -lines.Where(l => l.Amount < 0).Sum(l => l.Amount);
            if (debits != credits)
            {
                Log.Add($"rejected \"{memo}\": debits {debits} but credits {credits}, difference {debits - credits}");
                return false;
            }
            Journal.Add(new Entry(Journal.Count + 1, memo, lines, reverses));
            string text = string.Join(", ", lines.Select(l => $"{(l.Amount > 0 ? "Dr" : "Cr")} {l.Account} {Math.Abs(l.Amount)}"));
            Log.Add($"posted #{Journal.Count} \"{memo}\": {text}");
            return true;
        }

        public long Balance(string account) => Journal.Sum(e => e.Lines.Where(l => l.Account == account).Sum(l => l.Amount));

        // Column design: read the balance, add the change, write it back. It has no entries to check anything against.
        public void ApplyInPlace(Line[] lines) { foreach (var l in lines) Column[l.Account] += l.Amount; }

        // Two operations at the same time in the column design: both read before either writes, so the second write wins.
        public void ConcurrentInPlace(Line[] a, Line[] b)
        {
            var snapshot = new Dictionary<string, long>(Column);
            foreach (var lines in new[] { a, b })
                foreach (var l in lines) Column[l.Account] = snapshot[l.Account] + l.Amount;
        }
    }

    static Line[] CardPayment(long amount, long fee) => new[] { new Line("cash_at_bank", amount), new Line("merchant_payable", -(amount - fee)), new Line("fees_revenue", -fee) };
    static Line[] Negate(Line[] lines) => lines.Select(l => new Line(l.Account, -l.Amount)).ToArray();

    public static void Main()
    {
        var books = new Books();
        void Run(string memo, Line[] lines) { books.Post(memo, lines); books.ApplyInPlace(lines); }

        Run("card payment 100.00, fee 3.00", CardPayment(10000, 300));

        // Two card payments at the same moment. The journal appends both. The balance column loses one.
        var a = CardPayment(10000, 300);
        var b = CardPayment(10000, 300);
        books.Post("card payment 100.00, fee 3.00 (A)", a);
        books.Post("card payment 100.00, fee 3.00 (B)", b);
        books.ConcurrentInPlace(a, b);

        // An entry that does not balance: the journal refuses it. The column design applies it and nobody notices.
        var bad = new[] { new Line("cash_at_bank", 5000), new Line("merchant_payable", -4900) };
        books.Post("deliberately unbalanced entry", bad);
        books.ApplyInPlace(bad);

        Run("refund of the first payment 100.00 (fee returned)", new[] { new Line("merchant_payable", 9700), new Line("fees_revenue", 300), new Line("cash_at_bank", -10000) });

        long owed = -books.Balance("merchant_payable");
        Run("payout of everything owed to the merchant", new[] { new Line("merchant_payable", owed), new Line("cash_at_bank", -owed) });

        Run("wallet top-up 50.00", new[] { new Line("cash_at_bank", 5000), new Line("customer_wallet", -5000) });

        // A correction is a new entry that reverses the old one. The old entry stays in the journal.
        var last = books.Journal[^1];
        books.Post($"reversal of #{last.Id}", Negate(last.Lines), last.Id);
        books.ApplyInPlace(Negate(last.Lines));

        Console.WriteLine("-- journal");
        foreach (var line in books.Log) Console.WriteLine(line);
        Console.WriteLine($"entries in the journal: {books.Journal.Count}");

        Console.WriteLine("-- balances (debit positive, credit negative)");
        long total = 0, columnTotal = 0, lost = 0;
        foreach (var acct in Accounts)
        {
            long j = books.Balance(acct), c = books.Column[acct];
            total += j; columnTotal += c; lost += Math.Abs(j - c);
            Console.WriteLine($"{acct}: journal {j}, balance column {c}, {(j == c ? "same" : $"column differs by {c - j}")}");
        }
        Console.WriteLine($"trial balance: journal {total}, balance column {columnTotal}");
        Console.WriteLine($"money the balance column got wrong: {lost}");
    }
}
