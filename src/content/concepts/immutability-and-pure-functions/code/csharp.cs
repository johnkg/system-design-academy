// Immutability and pure functions: a shared-state bug, then the cost of avoiding it, in element copies (never time).
// Look for: the impure preview gives three different totals for one cart; copying everything costs n per update, structural sharing
// costs a fixed few dozen, and for tiny lists plain copying is cheaper. Costs here come from an explicit model, stated in each comment.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const int Coupon = 90; // percent of the price left after a 10 percent coupon

    static int PreviewImpure(int[] cart) // applies the coupon to the caller's list, then sums it
    {
        for (int i = 0; i < cart.Length; i++) cart[i] = cart[i] * Coupon / 100;
        return cart.Sum();
    }

    static int PreviewPure(int[] cart) // returns a new total and leaves the caller's list alone
    {
        return cart.Select(p => p * Coupon / 100).Sum();
    }

    static int TreeDepth(int n) // levels of a 32-way tree that holds n items
    {
        int levels = 1;
        long capacity = 32;
        while (capacity < n) { capacity *= 32; levels++; }
        return levels;
    }

    public static void Main()
    {
        var cart = new[] { 1000, 2500, 400 }; // prices in cents
        var totals = new int[3];
        for (int w = 0; w < 3; w++) totals[w] = PreviewImpure(cart); // header badge, checkout summary, email
        Console.WriteLine($"impure preview, one cart, three widgets: {totals[0]}, {totals[1]}, {totals[2]}");
        cart = new[] { 1000, 2500, 400 };
        for (int w = 0; w < 3; w++) totals[w] = PreviewPure(cart);
        Console.WriteLine($"pure preview, one cart, three widgets: {totals[0]}, {totals[1]}, {totals[2]}");

        // Aliasing: three readers hold the same list; a writer changes the first element.
        var data = new[] { 10, 20, 30, 40, 50 };
        var readers = new[] { data, data, data };
        data[0] += 1;
        Console.WriteLine($"readers that saw the change when the list is shared and mutated: {readers.Count(r => r[0] != 10)} of 3");
        data = new[] { 10, 20, 30, 40, 50 };
        readers = new[] { data, data, data };
        data = new[] { 11 }.Concat(data.Skip(1)).ToArray(); // a new value; the old one is untouched
        Console.WriteLine($"readers that saw the change when updates build a new value: {readers.Count(r => r[0] != 10)} of 3");

        const int updates = 100;
        foreach (int n in new[] { 10, 100, 1000, 10000 })
        {
            int inPlace = updates; // one write per update
            int copyAll = updates * n; // each update copies all n items
            int sharing = updates * TreeDepth(n) * 32; // model: each update copies one 32-slot node per tree level
            int priv = n + updates; // copy once, mutate the private copy, then hand it out
            Console.WriteLine($"n={n}, {updates} updates: in place {inPlace}, copy every time {copyAll}, structural sharing {sharing}, private copy then freeze {priv}");
        }

        int m = 1;
        while (!(TreeDepth(m) * 32 < m)) m++;
        Console.WriteLine($"structural sharing is cheaper than copying everything only from n = {m}");
    }
}
