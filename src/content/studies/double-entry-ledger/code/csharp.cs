// A double-entry ledger in C#: immutable entries, balanced lines, idempotent posting,
// balances as a derived projection, a hot account split in shards, and corrections by reversal.
// Amounts are integer cents. A positive amount is a debit and a negative amount is a credit.
using System;
using System.Collections.Generic;
using System.Linq;

const ulong Seed = 2024;
const int Wallets = 4;
const long OpeningBalance = 1000000; // each wallet is funded from the bank
const int Payments = 2000;
const int MinAmount = 100; // payment amounts are 100..2099
const int AmountSpread = 2000;
const int FeePct = 3;
const int FeeShards = 8; // the hot fees account is split over fees#0 .. fees#7
const int RetryEvery = 13; // every 13th payment is retried by the client
const int BadEvery = 17; // every 17th has a buggy unbalanced twin
const int RefundEvery = 29; // every 29th triggers a refund, sent twice
ulong seed = Seed;
int Random(int n) { seed = (seed * 1664525UL + 1013904223UL) % 4294967296UL; return (int)((seed / 65536UL) % (ulong)n); }

var ledger = new Ledger();
int accepted = 0, duplicates = 0, unbalanced = 0, reversals = 0;
Entry? Tally(Func<(Entry, bool)> fn)
{
    try { var (entry, duplicate) = fn(); if (duplicate) duplicates++; else accepted++; return duplicate ? null : entry; }
    catch (InvalidOperationException err) when (err.Message == "unbalanced") { unbalanced++; return null; }
}

for (int w = 1; w <= Wallets; w++) { int n = w; Tally(() => ledger.Post($"init-{n}", new[] { ("bank", OpeningBalance), ($"wallet-{n}", -OpeningBalance) })); }
int last = 0;
for (int i = 0; i < Payments; i++)
{
    string wallet = $"wallet-{1 + Random(Wallets)}";
    long amount = MinAmount + Random(AmountSpread), fee = amount * FeePct / 100;
    int k = i;
    var lines = new[] { (wallet, amount), ("merchant", -(amount - fee)), ($"fees#{k % FeeShards}", -fee) };
    var posted = Tally(() => ledger.Post($"pay-{k}", lines));
    if (posted != null) last = posted.Seq;
    if (i % RetryEvery == 0) Tally(() => ledger.Post($"pay-{k}", lines));                                                       // the client retries
    if (i % BadEvery == 0) Tally(() => ledger.Post($"bad-{k}", new[] { (wallet, amount), ("merchant", -amount + 1) }));      // a bug: lines do not balance
    if (i % RefundEvery == 0) { int target = last; Tally(() => ledger.Reverse(target)); Tally(() => ledger.Reverse(target)); reversals++; } // refund, sent twice
}

var replayed = ledger.Replay();
long trial = ledger.Balances.Values.Sum();
var fees = Enumerable.Range(0, FeeShards).Select(j => ledger.Balances.GetValueOrDefault($"fees#{j}")).ToList();
Console.WriteLine($"accepted {accepted}, duplicates ignored {duplicates}, rejected unbalanced {unbalanced}, refunds {reversals}");
foreach (var a in new[] { "bank", "wallet-1", "wallet-2", "wallet-3", "wallet-4", "merchant" }) Console.WriteLine($"{a}: {ledger.Balances[a]}");
Console.WriteLine($"fees: {ledger.SumOf("fees#")} over {FeeShards} shards, each between {-fees.Max()} and {-fees.Min()} in credits");
bool matches = replayed.Count == ledger.Balances.Count && replayed.All(p => ledger.Balances[p.Key] == p.Value);
Console.WriteLine($"trial balance: {trial}; replay matches balances: {(matches ? "true" : "false")}");
if (trial != 0 || !matches || unbalanced == 0 || ledger.Entries.Count != accepted) Environment.Exit(1);

record Entry(int Seq, string Key, string Sig, (string Account, long Amount)[] Lines, int Reverses); // immutable

class Ledger
{
    public List<Entry> Entries = new();                           // the journal: append only, never changed
    public Dictionary<string, Entry> ByKey = new();               // idempotency key -> entry
    public Dictionary<string, long> Balances = new();             // derived state, updated with each entry

    public (Entry, bool) Post(string key, (string Account, long Amount)[] lines, int reverses = 0)
    {
        string sig = string.Join(",", lines.Select(l => $"{l.Account}:{l.Amount}"));
        if (ByKey.TryGetValue(key, out var seen)) // a retry of something already posted
        {
            if (seen.Sig != sig) throw new InvalidOperationException("key reused with different lines");
            return (seen, true);
        }
        if (lines.Length < 2 || lines.Any(l => l.Amount == 0)) throw new InvalidOperationException("invalid lines");
        if (lines.Sum(l => l.Amount) != 0) throw new InvalidOperationException("unbalanced");
        var entry = new Entry(Entries.Count + 1, key, sig, lines, reverses);
        Entries.Add(entry);
        ByKey[key] = entry;
        foreach (var (account, amount) in lines) Balances[account] = Balances.GetValueOrDefault(account) + amount;
        return (entry, false);
    }

    // A correction is a new entry with every line negated. The original stays in the journal.
    public (Entry, bool) Reverse(int seq) =>
        Post($"rev-{seq}", Entries[seq - 1].Lines.Select(l => (l.Account, -l.Amount)).ToArray(), seq);

    // Rebuild every balance from the journal alone, to check the derived state.
    public Dictionary<string, long> Replay()
    {
        var balances = new Dictionary<string, long>();
        foreach (var e in Entries) foreach (var (account, amount) in e.Lines) balances[account] = balances.GetValueOrDefault(account) + amount;
        return balances;
    }

    // A hot account is spread over sub-accounts such as fees#0 .. fees#7.
    public long SumOf(string prefix) => Balances.Where(p => p.Key.StartsWith(prefix)).Sum(p => p.Value);
}
