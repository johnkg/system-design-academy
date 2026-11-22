// A binary min-heap (a priority queue stored in a flat array), with every comparison counted instead of timed.
// Look for: building a heap bottom-up costs under 2n comparisons where pushing one at a time costs up to n log n; top-k
// with a heap of size k beats a full sort when k is small and loses its edge when k is large; an array kept sorted or
// unsorted makes one of push and pop cost O(n); decrease-key needs to know where an item is; a priority that never ages starves.
// A "step" is one element examined (compared, and maybe moved). The lists come from a fixed integer generator.
using System;
using System.Collections.Generic;
using System.Linq;

public class Heap
{
    public const long IdSpace = 100000; // a heap entry is priority * IdSpace + id, so equal priorities are ordered by id and every key is unique
    public List<long> A = new List<long>();
    public long C; // comparisons so far
    public int[] Pos; // where each id sits, for decrease-key

    public Heap(int trackPositions = 0) { if (trackPositions > 0) Pos = new int[trackPositions]; }

    void Put(int i, long key)
    {
        A[i] = key;
        if (Pos != null) Pos[(int)(key % IdSpace)] = i;
    }

    public void SiftUp(int i)
    {
        long key = A[i];
        while (i > 0)
        {
            int p = (i - 1) / 2;
            C++;
            if (key < A[p]) { Put(i, A[p]); i = p; } else break;
        }
        Put(i, key);
    }

    public void SiftDown(int i)
    {
        long key = A[i];
        int n = A.Count;
        while (true)
        {
            int s = 2 * i + 1;
            if (s >= n) break;
            if (s + 1 < n)
            {
                C++;
                if (A[s + 1] < A[s]) s++;
            }
            C++;
            if (A[s] < key) { Put(i, A[s]); i = s; } else break;
        }
        Put(i, key);
    }

    public void Push(long key)
    {
        A.Add(key);
        SiftUp(A.Count - 1);
    }

    public long Pop()
    {
        long top = A[0], last = A[A.Count - 1];
        A.RemoveAt(A.Count - 1);
        if (A.Count > 0) { A[0] = last; SiftDown(0); }
        return top;
    }

    // bottom-up: sift down every parent, last parent first
    public void Heapify(IEnumerable<long> items)
    {
        A = items.ToList();
        if (Pos != null) for (int i = 0; i < A.Count; i++) Pos[(int)(A[i] % IdSpace)] = i;
        for (int i = A.Count / 2 - 1; i >= 0; i--) SiftDown(i);
    }
}

public static class Program
{
    static List<long> MakeInput(string pattern, int n)
    {
        var a = new List<long>();
        ulong x = 12345;
        for (int i = 0; i < n; i++)
        {
            x = (x * 1664525UL + 1013904223UL) % 4294967296UL;
            long r = (long)((x / 65536UL) % 100000UL);
            a.Add(pattern == "descending" ? n - i : pattern == "ascending" ? i + 1 : r);
        }
        return a;
    }

    static long MergeSortCount(List<long> a)
    {
        long count = 0;
        List<long> Sort(List<long> v)
        {
            if (v.Count < 2) return v;
            var left = Sort(v.GetRange(0, v.Count / 2));
            var right = Sort(v.GetRange(v.Count / 2, v.Count - v.Count / 2));
            var o = new List<long>();
            int i = 0, j = 0;
            while (i < left.Count && j < right.Count)
            {
                count++;
                if (right[j] < left[i]) o.Add(right[j++]); else o.Add(left[i++]);
            }
            o.AddRange(left.Skip(i));
            o.AddRange(right.Skip(j));
            return o;
        }
        Sort(a);
        return count;
    }

    static long Prio(int i) => 20000 + ((long)i * 7919) % 10007;
    static long Lowered(int i) => Prio(i) - 1 - ((long)i * 4999) % 15000;

    public static void Main()
    {
        Console.WriteLine("-- building a heap of n items: n pushes against bottom-up heapify (comparisons)");
        foreach (int n in new[] { 10, 100, 1000, 10000 })
            foreach (var pattern in new[] { "random", "descending" })
            {
                var a = MakeInput(pattern, n);
                var h = new Heap();
                foreach (var v in a) h.Push(v);
                var g = new Heap();
                g.Heapify(a);
                long per = g.C * 100 / n;
                Console.WriteLine($"n={n} {pattern}: pushes {h.C}, heapify {g.C} ({per / 100}.{(per % 100).ToString().PadLeft(2, '0')} per item)");
            }

        Console.WriteLine("-- the k largest of n items: a heap of size k against sorting everything (comparisons)");
        foreach (int n in new[] { 1000, 10000 })
            foreach (int k in new[] { 10, 100, n / 2 })
            {
                var row = new List<string>();
                foreach (var pattern in new[] { "random", "ascending" })
                {
                    var a = MakeInput(pattern, n);
                    var h = new Heap();
                    h.Heapify(a.Take(k)); // a min-heap of the k largest so far: its root is the smallest of them
                    foreach (var x in a.Skip(k))
                    {
                        h.C++;
                        if (x > h.A[0]) { h.A[0] = x; h.SiftDown(0); }
                    }
                    row.Add($"{pattern} input {h.C}");
                }
                Console.WriteLine($"n={n} k={k}: heap: {string.Join(", ", row)}; full merge sort {MergeSortCount(MakeInput("random", n))}");
            }

        Console.WriteLine("-- n pushes then n pops, three ways to store a priority queue (steps)");
        foreach (int n in new[] { 10, 100, 1000, 10000 })
        {
            var a = MakeInput("random", n);
            var u = new List<long>();
            long stepsU = 0; // unsorted array: push is free, pop scans everything for the minimum
            foreach (var v in a) { u.Add(v); stepsU++; }
            while (u.Count > 0)
            {
                stepsU += u.Count;
                int m = 0;
                for (int i = 1; i < u.Count; i++) if (u[i] < u[m]) m = i; // removing the minimum, written as a scan: len(u) steps
                u.RemoveAt(m);
            }
            var s = new List<long>();
            long stepsS = 0; // array kept sorted (largest first): insertion shifts items, pop takes the last one
            foreach (var v in a)
            {
                s.Add(v);
                int j = s.Count - 1;
                while (j > 0)
                {
                    stepsS++;
                    if (s[j - 1] < v) { s[j] = s[j - 1]; j--; } else break;
                }
                s[j] = v;
            }
            while (s.Count > 0) { s.RemoveAt(s.Count - 1); stepsS++; }
            var h = new Heap();
            foreach (var v in a) h.Push(v);
            while (h.A.Count > 0) h.Pop();
            Console.WriteLine($"n={n}: unsorted array {stepsU}, sorted array {stepsS}, heap {h.C}");
        }

        Console.WriteLine("-- n decrease-key updates, then drain: where is the item?");
        foreach (int n in new[] { 100, 1000, 10000 })
        {
            var start = new List<long>();
            for (int i = 0; i < n; i++) start.Add(Prio(i) * Heap.IdSpace + i);
            // (a) the heap knows each item's position: change the key and sift it up
            var h = new Heap(n);
            h.Heapify(start);
            long b = h.C;
            for (int i = 0; i < n; i++)
            {
                int j = h.Pos[i];
                h.A[j] = Lowered(i) * Heap.IdSpace + i;
                h.SiftUp(j);
            }
            long updA = h.C - b;
            var orderA = new List<long>();
            while (h.A.Count > 0) orderA.Add(h.Pop() % Heap.IdSpace);
            long drainA = h.C - b - updA;
            // (b) no position index: scan the array for the item first
            var g = new Heap();
            g.Heapify(start);
            b = g.C;
            long scan = 0;
            for (int i = 0; i < n; i++)
            {
                int j = 0;
                while (g.A[j] % Heap.IdSpace != i) j++;
                scan += j + 1;
                g.A[j] = Lowered(i) * Heap.IdSpace + i;
                g.SiftUp(j);
            }
            long updB = g.C - b + scan;
            var orderB = new List<long>();
            while (g.A.Count > 0) orderB.Add(g.Pop() % Heap.IdSpace);
            long drainB = g.C - b - (updB - scan);
            // (c) lazy: push a second entry with the new priority, leave the old one, skip stale entries when they surface
            var z = new Heap();
            z.Heapify(start);
            b = z.C;
            var current = new long[n];
            for (int i = 0; i < n; i++) current[i] = Prio(i);
            for (int i = 0; i < n; i++)
            {
                current[i] = Lowered(i);
                z.Push(current[i] * Heap.IdSpace + i);
            }
            long updC = z.C - b;
            int peak = z.A.Count;
            var orderC = new List<long>();
            var seen = new bool[n];
            long stale = 0;
            while (z.A.Count > 0)
            {
                long key = z.Pop();
                int i = (int)(key % Heap.IdSpace);
                if (key / Heap.IdSpace != current[i] || seen[i]) stale++;
                else { seen[i] = true; orderC.Add(i); }
            }
            long drainC = z.C - b - updC;
            if (!orderA.SequenceEqual(orderB) || !orderA.SequenceEqual(orderC)) throw new Exception("the three methods disagree");
            Console.WriteLine($"n={n}: indexed {updA} + {drainA} = {updA + drainA}; scan to find {updB} + {drainB} = {updB + drainB}; lazy duplicates {updC} + {drainC} = {updC + drainC} (heap grew to {peak}, {stale} stale entries popped)");
        }

        Console.WriteLine("-- a scheduler that serves one task per tick: does a priority-9 task from tick 0 ever run?");
        foreach (long age in new long[] { 1000000, 100, 50, 10 })
        {
            // key = priority * age + arrival tick: a larger `age` means priority dominates; no aging is age = 1,000,000
            var h = new Heap();
            h.Push((9 * age + 0) * 10000 + 0);
            long served = -1;
            for (int t = 1; t <= 2000; t++)
            {
                long p = (t * 7 + 3) % 5 + 1; // arrivals are priorities 1 to 5
                h.Push((p * age + t) * 10000 + t);
                if (h.Pop() % 10000 == 0 && served < 0) { served = t; break; }
            }
            string label = served < 0 ? "never within 2000 ticks" : $"served at tick {served}";
            Console.WriteLine($"{(age == 1000000 ? "no aging" : $"aging: one priority level = {age} ticks")}: {label}");
        }
    }
}
