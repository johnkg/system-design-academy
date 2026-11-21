// Sorting and searching, counted in comparisons (and steps for counting sort), never in time.
// Look for: insertion sort and first-element quicksort are quadratic on some inputs, merge sort is about n log n on all of
// them, a heap finds the top 10 with far fewer comparisons than a full sort, and sorting only pays for searching after enough searches.
// The "random" input comes from a fixed integer generator, so every language prints the same numbers.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    static List<long> MakeInput(string pattern, int n)
    {
        var a = new List<long>();
        long x = 12345;
        for (int i = 0; i < n; i++)
        {
            x = (x * 1664525 + 1013904223) % 4294967296;
            long r = (x / 65536) % 100000;
            a.Add(pattern == "sorted" ? i + 1 : pattern == "reversed" ? n - i : pattern == "duplicates" ? r % 10 : r);
        }
        return a;
    }

    static long Ident(long v) => v;

    // Every sort returns the number of comparisons of two keys. keyOf says what to compare, so records can be sorted by one field.
    static long InsertionSort(List<long> a, Func<long, long> keyOf)
    {
        long count = 0;
        for (int i = 1; i < a.Count; i++)
        {
            long v = a[i];
            int j = i;
            while (j > 0)
            {
                count++;
                if (keyOf(a[j - 1]) > keyOf(v)) { a[j] = a[j - 1]; j--; } else break;
            }
            a[j] = v;
        }
        return count;
    }

    static long MergeSort(List<long> a, Func<long, long> keyOf)
    {
        long count = 0;
        void Sort(int lo, int hi) // sorts a[lo..hi)
        {
            if (hi - lo < 2) return;
            int mid = (lo + hi) / 2;
            Sort(lo, mid); Sort(mid, hi);
            var left = a.GetRange(lo, mid - lo); var right = a.GetRange(mid, hi - mid);
            int i = 0, j = 0, k = lo;
            while (i < left.Count && j < right.Count)
            {
                count++;
                if (keyOf(right[j]) < keyOf(left[i])) a[k++] = right[j++]; else a[k++] = left[i++]; // ties take the left one: stable
            }
            while (i < left.Count) a[k++] = left[i++];
            while (j < right.Count) a[k++] = right[j++];
        }
        Sort(0, a.Count);
        return count;
    }

    // Quicksort with the FIRST element as pivot (a naive choice), Lomuto partition, explicit stack so deep recursion cannot overflow.
    static long QuickSort(List<long> a, Func<long, long> keyOf)
    {
        long count = 0;
        var stack = new Stack<(int, int)>();
        stack.Push((0, a.Count - 1));
        while (stack.Count > 0)
        {
            var (lo, hi) = stack.Pop();
            if (lo >= hi) continue;
            long pivot = keyOf(a[lo]);
            int i = lo;
            for (int j = lo + 1; j <= hi; j++)
            {
                count++;
                if (keyOf(a[j]) < pivot) { i++; (a[i], a[j]) = (a[j], a[i]); }
            }
            (a[lo], a[i]) = (a[i], a[lo]);
            stack.Push((lo, i - 1)); stack.Push((i + 1, hi));
        }
        return count;
    }

    // Counting sort: no comparisons at all. Steps = n to count, (largest key + 1) to scan the counts, n to write out.
    static long CountingSort(List<long> a)
    {
        long max = 0;
        foreach (var v in a) max = Math.Max(max, v);
        var counts = new long[max + 1];
        long steps = 0;
        foreach (var v in a) { counts[v]++; steps++; }
        for (int v = 0; v <= max; v++) { steps++; for (long c = 0; c < counts[v]; c++) steps++; }
        return steps;
    }

    // Top k with a min-heap of size k: n log k instead of n log n. Counts comparisons, sift-up and sift-down included.
    static (long count, List<long> top) TopK(List<long> a, int k)
    {
        long count = 0;
        var h = new List<long>();
        void SiftUp(int i)
        {
            while (i > 0)
            {
                int p = (i - 1) >> 1;
                count++;
                if (h[i] < h[p]) { (h[i], h[p]) = (h[p], h[i]); i = p; } else break;
            }
        }
        void SiftDown(int i)
        {
            for (;;)
            {
                int l = 2 * i + 1, r = l + 1;
                if (l >= h.Count) break;
                int s = l;
                if (r < h.Count) { count++; if (h[r] < h[l]) s = r; }
                count++;
                if (h[s] < h[i]) { (h[i], h[s]) = (h[s], h[i]); i = s; } else break;
            }
        }
        foreach (var x in a)
        {
            if (h.Count < k) { h.Add(x); SiftUp(h.Count - 1); }
            else { count++; if (x > h[0]) { h[0] = x; SiftDown(0); } }
        }
        return (count, h.OrderByDescending(v => v).ToList());
    }

    // Binary search: one comparison per probe. Linear search: one per element looked at. Both look for the LAST element.
    static int BinarySearch(List<long> a, long target)
    {
        int lo = 0, hi = a.Count - 1, count = 0;
        while (lo <= hi)
        {
            int mid = (lo + hi) / 2;
            count++;
            if (a[mid] == target) return count;
            if (a[mid] < target) lo = mid + 1; else hi = mid - 1;
        }
        return count;
    }

    // The classic bug: "lo = mid" instead of "lo = mid + 1" never makes progress when lo and mid meet. Capped at 50 probes here.
    static int BuggyBinarySearch(List<long> a, long target)
    {
        int lo = 0, hi = a.Count - 1, count = 0;
        while (lo < hi && count < 50)
        {
            int mid = (lo + hi) / 2;
            count++;
            if (a[mid] < target) lo = mid; else hi = mid;
        }
        return count;
    }

    static string Ids(List<long> a) => string.Join(" ", a.Select(v => v % 1000));

    public static void Main()
    {
        Console.WriteLine("-- comparisons to sort n items (counting sort: steps)");
        foreach (int n in new[] { 10, 100, 1000 })
            foreach (var pattern in new[] { "random", "sorted", "reversed", "duplicates" })
            {
                var b = MakeInput(pattern, n);
                long ins = InsertionSort(new(b), Ident), mer = MergeSort(new(b), Ident), qs = QuickSort(new(b), Ident), cs = CountingSort(b);
                Console.WriteLine($"n={n} {pattern}: insertion {ins}, merge {mer}, quicksort(first pivot) {qs}, counting steps {cs}, top-10 heap {TopK(b, 10).count}");
            }

        // The sorts really sort, and the heap really finds the 10 largest.
        {
            var a = MakeInput("random", 1000);
            var sorted = new List<long>(a); MergeSort(sorted, Ident);
            var i2 = new List<long>(a); InsertionSort(i2, Ident);
            var q2 = new List<long>(a); QuickSort(q2, Ident);
            if (!i2.SequenceEqual(sorted) || !q2.SequenceEqual(sorted)) throw new Exception("not sorted");
            var expected = sorted.Skip(sorted.Count - 10).Reverse().ToList();
            Console.WriteLine($"-- heap top 10 equals the last 10 of the full sort: {(TopK(a, 10).top.SequenceEqual(expected) ? "true" : "false")}");
        }

        Console.WriteLine("-- searching for the last item of a sorted list");
        foreach (int n in new[] { 10, 1000, 1000000 })
        {
            var a = MakeInput("sorted", n);
            int linear = 0;
            for (int i = 0; i < n; i++) { linear++; if (a[i] == n) break; }
            Console.WriteLine($"n={n}: linear {linear} comparisons, binary {BinarySearch(a, n)}");
        }
        Console.WriteLine($"buggy binary search (lo = mid) on 10 items: {BuggyBinarySearch(MakeInput("sorted", 10), 10)} probes, then gave up at the cap of 50");

        // Sorting once to search many times: sort cost against the saving of binary over linear search (average linear cost about n/2).
        Console.WriteLine("-- searches needed before sorting first pays off");
        foreach (int n in new[] { 100, 1000, 10000 })
        {
            long sortCost = MergeSort(MakeInput("random", n), Ident);
            long linear = (n + 1) / 2, binary = (long)Math.Floor(Math.Log2(n)) + 1;
            long q = 1;
            while (sortCost + q * binary >= q * linear) q++;
            Console.WriteLine($"n={n}: sort {sortCost}, linear {linear} per search, binary {binary} per search, break-even at {q} searches");
        }

        // Traps: sorting to find the minimum, sorting inside a loop, a key recomputed in every comparison.
        Console.WriteLine("-- traps");
        {
            int n = 1000;
            var a = MakeInput("random", n);
            long sortCost = MergeSort(new(a), Ident);
            Console.WriteLine($"minimum of {n}: a scan needs {n - 1} comparisons, sorting first needs {sortCost}");
            Console.WriteLine($"100 lookups that each re-sort {n} items: {100 * sortCost} comparisons; sorting once: {sortCost}");
            Console.WriteLine($"sort {n} items by a computed key: {2 * sortCost} key computations if the comparator recomputes both keys, {n} if keys are computed once first");
        }

        // Stability: records are key*1000 + id. Equal keys should keep their original order (ids ascending).
        Console.WriteLine("-- stability: ids of the records after sorting by key");
        {
            var records = new List<long> { 2001, 1002, 2003, 1004, 2005, 1006, 2007, 1008 };
            Func<long, long> key = v => v / 1000;
            var i = new List<long>(records); InsertionSort(i, key);
            var m = new List<long>(records); MergeSort(m, key);
            var q = new List<long>(records); QuickSort(q, key);
            Console.WriteLine($"insertion (stable): {Ids(i)}");
            Console.WriteLine($"merge (stable): {Ids(m)}");
            Console.WriteLine($"quicksort (not stable): {Ids(q)}");
        }
    }
}
