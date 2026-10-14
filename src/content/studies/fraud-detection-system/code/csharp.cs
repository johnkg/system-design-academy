// A real-time fraud scorer in C#:
// velocity counters in time buckets, rules plus a small model, a decision (allow, challenge, block),
// and a candidate rule tested in shadow mode against later chargeback labels.
using System;
using System.Collections.Generic;

public class Counters
{
    public int[] Id = new int[Velocity.Buckets];
    public int[] N = new int[Velocity.Buckets];
    public int[] Sum = new int[Velocity.Buckets];
    public Counters() { Array.Fill(Id, -1); }
}

public class Velocity
{
    public const int Bucket = 10, Buckets = 6; // a 60-second window made of six 10-second buckets
    readonly Dictionary<int, Counters> cards = new();

    // Count and total of the card's payments in the last 60 seconds, read before the new payment is added.
    public (int Count, int Total) Read(int card, int t)
    {
        int count = 0, total = 0, now = t / Bucket;
        if (!cards.TryGetValue(card, out var c)) return (0, 0);
        for (int i = 0; i < Buckets; i++)
            if (c.Id[i] != -1 && now - c.Id[i] < Buckets) { count += c.N[i]; total += c.Sum[i]; }
        return (count, total);
    }

    public void Add(int card, int t, int amount)
    {
        if (!cards.TryGetValue(card, out var c)) cards[card] = c = new Counters();
        int now = t / Bucket, slot = now % Buckets;
        if (c.Id[slot] != now) { c.Id[slot] = now; c.N[slot] = 0; c.Sum[slot] = 0; } // a stale bucket is reused
        c.N[slot]++; c.Sum[slot] += amount;
    }
}

public static class Program
{
    // Rules are exact and explainable; the model adds a graded score from the same features. Amounts are in cents.
    static int Rules(int count, int amount) => (count >= 3 ? 40 : 0) + (amount >= 15000 ? 20 : 0);
    static int Model(int count, int total, int amount) => Math.Min(60, 6 * count + total / 1500 + amount / 1000);
    static int Candidate(int count, int amount) => amount >= 8000 && count >= 1 ? 35 : 0; // new rule, evaluated in shadow
    static string Decide(int score) => score >= 70 ? "block" : score >= 40 ? "challenge" : "allow";

    static int Price(string d, bool fraud, int amount) =>
        fraud ? (d == "block" ? 0 : d == "challenge" ? 300 : amount) : d == "block" ? 2500 : d == "challenge" ? 40 : 0;

    static ulong seed = 7;
    static int Random(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)((seed / 65536) % (ulong)n); }

    public static int Main()
    {
        int[] stolen = { 3, 41, 77, 120, 158 }; // cards that a thief is using from second 300 on
        var velocity = new Velocity();
        int allow = 0, challenge = 0, block = 0, costLive = 0, costShadow = 0, changed = 0, caught = 0, hurt = 0;
        int fraudTotal = 0, fraudBlocked = 0, goodBlocked = 0, goodChallenged = 0;

        for (int t = 0; t < 1200; t++)
        {
            for (int k = 0; k < 2; k++) // two events per second: a normal purchase, or a thief using a stolen card
            {
                bool fraud = t >= 300 && Random(100) < 18;
                int card = fraud ? stolen[Random(stolen.Length)] : Random(200);
                int amount = fraud ? 6000 + Random(24000) : 500 + Random(5500) + (card % 50 == 9 ? Random(12000) : 0);
                var (count, total) = velocity.Read(card, t);
                int baseScore = Math.Min(100, Rules(count, amount) + Model(count, total, amount));
                int withNew = Math.Min(100, baseScore + Candidate(count, amount));
                string d = Decide(baseScore), dNew = Decide(withNew); // only d is acted on
                if (d == "allow") allow++; else if (d == "challenge") challenge++; else block++;
                if (fraud) { fraudTotal++; if (d == "block") fraudBlocked++; }
                else { if (d == "block") goodBlocked++; if (d == "challenge") goodChallenged++; }
                costLive += Price(d, fraud, amount); costShadow += Price(dNew, fraud, amount);
                if (dNew != d) { changed++; if (fraud) caught++; else hurt++; }
                velocity.Add(card, t, amount);
            }
        }

        Console.WriteLine($"decisions: allow {allow}, challenge {challenge}, block {block}");
        Console.WriteLine($"fraud blocked {fraudBlocked} of {fraudTotal}; good payments blocked {goodBlocked}, challenged {goodChallenged}");
        Console.WriteLine($"shadow rule would change {changed} decisions: {caught} on fraud, {hurt} on good payments");
        Console.WriteLine($"loss in cents with the live rules {costLive}, with the candidate added {costShadow}");
        Console.WriteLine($"promote the candidate rule: {(costShadow < costLive ? "true" : "false")}");
        return allow + challenge + block != 2400 || fraudBlocked > fraudTotal || caught + hurt != changed ? 1 : 0;
    }
}
