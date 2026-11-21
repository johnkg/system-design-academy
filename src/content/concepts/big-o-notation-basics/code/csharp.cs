// Big O: count operations (one comparison or one element visit each), never time, for five algorithms at growing n.
// Look for: the counts grow at different rates. Doubling n makes the n^2 check cost 4x, while binary search barely moves.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    static long ops = 0;

    static long LinearSearch(int[] a, int target) // worst case: the target is not there, so every element is visited
    {
        ops = 0;
        foreach (var x in a) { ops++; if (x == target) break; }
        return ops;
    }

    static long BinarySearch(int[] a, int target) // one comparison per halving of the range
    {
        ops = 0;
        int lo = 0, hi = a.Length - 1;
        while (lo <= hi)
        {
            ops++;
            int mid = (lo + hi) / 2;
            if (a[mid] == target) break;
            if (a[mid] < target) lo = mid + 1; else hi = mid - 1;
        }
        return ops;
    }

    static long HasDuplicateNested(int[] a) // compares every pair once; no duplicates here, so it never stops early
    {
        ops = 0;
        for (int i = 0; i < a.Length; i++)
            for (int j = i + 1; j < a.Length; j++) { ops++; if (a[i] == a[j]) return ops; }
        return ops;
    }

    static int[] MergeSort(int[] a) // counts the comparisons made while merging
    {
        if (a.Length <= 1) return a;
        int mid = a.Length / 2;
        var left = MergeSort(a[..mid]);
        var right = MergeSort(a[mid..]);
        var output = new List<int>();
        int i = 0, j = 0;
        while (i < left.Length && j < right.Length) { ops++; output.Add(left[i] <= right[j] ? left[i++] : right[j++]); }
        while (i < left.Length) output.Add(left[i++]);
        while (j < right.Length) output.Add(right[j++]);
        return output.ToArray();
    }

    static long CountSubsets(int n) // visits every subset of n items: 2^n of them
    {
        ops = 0;
        for (long mask = 0; mask < (1L << n); mask++) ops++;
        return ops;
    }

    public static void Main()
    {
        foreach (int n in new[] { 10, 100, 1000 })
        {
            var data = Enumerable.Range(0, n).Select(i => (i * 7919) % n).ToArray(); // a fixed shuffle of 0..n-1, no duplicates
            var sorted = Enumerable.Range(0, n).ToArray();
            long linear = LinearSearch(data, -1);
            long binary = BinarySearch(sorted, n); // absent and larger than everything: worst case
            long nested = HasDuplicateNested(data);
            ops = 0; MergeSort(data); long sort = ops;
            Console.WriteLine($"n={n}: linear search {linear}, binary search {binary}, nested duplicate check {nested}, merge sort {sort}");
        }
        foreach (int n in new[] { 10, 15, 20 }) Console.WriteLine($"subsets of {n} items: {CountSubsets(n)} visited");

        // A constant factor: an O(n) algorithm that does 100 steps per item against a plain O(n^2) one.
        long k = 1;
        while (!(100 * k < k * k)) k++;
        Console.WriteLine($"100n beats n^2 only from n = {k}");
    }
}
