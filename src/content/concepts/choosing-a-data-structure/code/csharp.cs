// Choosing a data structure: six structures run the same workload, and we count steps (element visits, comparisons, element moves).
// Look for: no structure wins every operation. The hash map has the cheapest lookup but must visit everything for a range; the sorted
// array has cheap range and smallest but pays for every insert; the heap only knows its smallest; the tree is never the worst.
// Counts are an explicit model: one step is one element visit, comparison, write or element shifted. Shifting the elements after an insert
// into an array is counted by length, because a real array does it with one bulk copy, which is typically much cheaper per element.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    static long ops = 0;
    const int Space = 1000003; // keys are distinct integers below this prime: key(i) = (i * 7919 + 13) % Space
    static int Key(int i) => (int)(((long)i * 7919 + 13) % Space);

    interface IStructure
    {
        int Lookup(int k);
        void Insert(int k);
        int Range(int lo, int hi);
        int Smallest();
    }

    class UnsortedArray : IStructure
    {
        List<int> a;
        public UnsortedArray(List<int> keys, int buckets) { a = new List<int>(keys); }
        public int Lookup(int k) { foreach (var x in a) { ops++; if (x == k) return 1; } return 0; }
        public void Insert(int k) { ops++; a.Add(k); }
        public int Range(int lo, int hi) { int found = 0; foreach (var x in a) { ops++; if (lo <= x && x < hi) found++; } return found; }
        public int Smallest() { int best = a[0]; foreach (var x in a) { ops++; best = Math.Min(best, x); } return best; }
    }

    class SortedArray : IStructure
    {
        List<int> s;
        public SortedArray(List<int> keys, int buckets) { s = new List<int>(keys); s.Sort(); }
        int LowerBound(int k) // binary search, one comparison per halving
        {
            int lo = 0, hi = s.Count;
            while (lo < hi)
            {
                ops++;
                int mid = (lo + hi) / 2;
                if (s[mid] < k) lo = mid + 1; else hi = mid;
            }
            return lo;
        }
        public int Lookup(int k) { int i = LowerBound(k); ops++; return i < s.Count && s[i] == k ? 1 : 0; }
        public void Insert(int k)
        {
            int i = LowerBound(k);
            ops += 1 + s.Count - i; // the write, plus every later element shifted one place
            s.Insert(i, k);
        }
        public int Range(int lo, int hi)
        {
            int i = LowerBound(lo), found = 0;
            while (i < s.Count) { ops++; if (s[i] >= hi) break; found++; i++; }
            return found;
        }
        public int Smallest() { ops++; return s[0]; }
    }

    class ListNode
    {
        public int K;
        public ListNode? Next;
        public ListNode(int k, ListNode? next) { K = k; Next = next; }
    }

    class LinkedList : IStructure
    {
        ListNode? head = null;
        public LinkedList(List<int> keys, int buckets) { foreach (var k in keys) head = new ListNode(k, head); }
        public int Lookup(int k) { for (var n = head; n != null; n = n.Next) { ops++; if (n.K == k) return 1; } return 0; }
        public void Insert(int k) { ops++; head = new ListNode(k, head); }
        public int Range(int lo, int hi) { int found = 0; for (var n = head; n != null; n = n.Next) { ops++; if (lo <= n.K && n.K < hi) found++; } return found; }
        public int Smallest() { int best = head!.K; for (var n = head; n != null; n = n.Next) { ops++; best = Math.Min(best, n.K); } return best; }
    }

    class HashMap : IStructure // chained buckets, sized once for the data it will hold (no resizing is counted)
    {
        int b;
        List<int>[] t;
        int count = 0;
        public HashMap(List<int> keys, int buckets)
        {
            b = buckets;
            t = new List<int>[buckets];
            for (int i = 0; i < buckets; i++) t[i] = new List<int>();
            foreach (var k in keys) { t[k % b].Add(k); count++; }
        }
        public int Lookup(int k) { ops++; foreach (var x in t[k % b]) { ops++; if (x == k) return 1; } return 0; }
        public void Insert(int k)
        {
            ops++;
            var chain = t[k % b];
            for (int i = 0; i < chain.Count; i++) ops++; // a map must check that the key is not already there
            chain.Add(k);
            count++;
        }
        public int Range(int lo, int hi) // no order: visit every bucket and every element
        {
            ops += b + count;
            int found = 0;
            foreach (var chain in t) foreach (var x in chain) if (lo <= x && x < hi) found++;
            return found;
        }
        public int Smallest()
        {
            ops += b + count;
            int best = int.MaxValue;
            foreach (var chain in t) foreach (var x in chain) best = Math.Min(best, x);
            return best;
        }
    }

    class AvlNode
    {
        public int K;
        public AvlNode? L, R;
        public int H = 1;
        public AvlNode(int k) { K = k; }
    }

    static int Height(AvlNode? n) => n == null ? 0 : n.H;
    static void Update(AvlNode n) { n.H = 1 + Math.Max(Height(n.L), Height(n.R)); }
    static AvlNode RotRight(AvlNode y) { ops++; var x = y.L!; y.L = x.R; x.R = y; Update(y); Update(x); return x; }
    static AvlNode RotLeft(AvlNode x) { ops++; var y = x.R!; x.R = y.L; y.L = x; Update(x); Update(y); return y; }

    static AvlNode AvlInsert(AvlNode? n, int k)
    {
        ops++; // one node visited, or the new node written
        if (n == null) return new AvlNode(k);
        if (k < n.K) n.L = AvlInsert(n.L, k); else n.R = AvlInsert(n.R, k);
        Update(n);
        int bal = Height(n.L) - Height(n.R);
        if (bal > 1)
        {
            if (Height(n.L!.L) < Height(n.L.R)) n.L = RotLeft(n.L);
            return RotRight(n);
        }
        if (bal < -1)
        {
            if (Height(n.R!.R) < Height(n.R.L)) n.R = RotRight(n.R);
            return RotLeft(n);
        }
        return n;
    }

    class BalancedTree : IStructure // an AVL tree
    {
        AvlNode? root = null;
        public BalancedTree(List<int> keys, int buckets) { foreach (var k in keys) root = AvlInsert(root, k); }
        public int Lookup(int k)
        {
            for (var n = root; n != null;) { ops++; if (k == n.K) return 1; n = k < n.K ? n.L : n.R; }
            return 0;
        }
        public void Insert(int k) { root = AvlInsert(root, k); }
        public int Range(int lo, int hi) // in-order walk that skips subtrees outside the range
        {
            int found = 0;
            void Walk(AvlNode? n)
            {
                if (n == null) return;
                ops++;
                if (lo < n.K) Walk(n.L);
                if (lo <= n.K && n.K < hi) found++;
                if (n.K < hi) Walk(n.R);
            }
            Walk(root);
            return found;
        }
        public int Smallest() { var n = root!; while (n.L != null) { ops++; n = n.L; } ops++; return n.K; }
    }

    class MinHeap : IStructure // array-based binary heap: knows its smallest, nothing else
    {
        List<int> h = new List<int>();
        public MinHeap(List<int> keys, int buckets) { foreach (var k in keys) Insert(k); }
        public int Lookup(int k) { foreach (var x in h) { ops++; if (x == k) return 1; } return 0; }
        public void Insert(int k)
        {
            ops++;
            h.Add(k);
            int i = h.Count - 1;
            while (i > 0)
            {
                int p = (i - 1) / 2;
                ops++;
                if (h[p] > h[i]) { (h[p], h[i]) = (h[i], h[p]); i = p; } else break;
            }
        }
        public int Range(int lo, int hi) { int found = 0; foreach (var x in h) { ops++; if (lo <= x && x < hi) found++; } return found; }
        public int Smallest() { ops++; return h[0]; }
    }

    // name, constructor, 2 = follows pointers
    static readonly (string Name, Func<List<int>, int, IStructure> Make, int Pointer)[] Structures =
    {
        ("unsorted array", (k, b) => new UnsortedArray(k, b), 1), ("sorted array", (k, b) => new SortedArray(k, b), 1),
        ("linked list", (k, b) => new LinkedList(k, b), 2), ("hash map", (k, b) => new HashMap(k, b), 1),
        ("balanced tree", (k, b) => new BalancedTree(k, b), 2), ("binary heap", (k, b) => new MinHeap(k, b), 1),
    };

    // returns steps for lookups, inserts, ranges, smallest queries, and the key results found
    static (long Lk, long Ins, long Rg, long Sm, long Found) Run(Func<List<int>, int, IStructure> make, int n, int lookups, int inserts, int ranges, int smallests)
    {
        var keys = new List<int>();
        for (int i = 0; i < n; i++) keys.Add(Key(i));
        var s = make(keys, 2 * (n + inserts) + 1);
        long found = 0;
        ops = 0;
        for (int t = 0; t < lookups; t++) found += s.Lookup(Key((t * 37 + 11) % n));
        long lk = ops;
        ops = 0;
        int width = 10 * Space / n; // about 10 keys fall in a range this wide
        for (int t = 0; t < ranges; t++)
        {
            int lo = (int)((long)t * 104729 % Space);
            found += s.Range(lo, lo + width);
        }
        long rg = ops;
        ops = 0;
        for (int t = 0; t < smallests; t++) found += s.Smallest() >= 0 ? 1 : 0;
        long sm = ops;
        ops = 0;
        for (int t = 0; t < inserts; t++) s.Insert(Key(n + t));
        long ins = ops;
        return (lk, ins, rg, sm, found);
    }

    static int Fewest(long[] totals) => Array.IndexOf(totals, totals.Min());

    public static void Main()
    {
        var mixes = new (string Name, int L, int I, int R, int M)[]
        {
            ("lookup-heavy", 1000, 10, 0, 0), ("insert-heavy", 10, 1000, 0, 0), ("range reports", 20, 5, 500, 0),
            ("priority queue", 0, 500, 0, 500), ("mixed", 200, 200, 200, 200),
        };

        bool agree = true;
        foreach (int n in new[] { 100, 1000, 10000 })
        {
            Console.WriteLine($"n={n}, 100 of each operation:");
            var founds = new HashSet<long>();
            foreach (var (name, make, _p) in Structures)
            {
                var r = Run(make, n, 100, 100, 100, 100);
                founds.Add(r.Found);
                Console.WriteLine($"  {name}: lookup {r.Lk}, insert {r.Ins}, range {r.Rg}, smallest {r.Sm}, total {r.Lk + r.Ins + r.Rg + r.Sm}");
            }
            agree = agree && founds.Count == 1;
        }
        Console.WriteLine($"all six structures return the same results: {(agree ? "yes" : "no")}");

        foreach (var (mix, l, i, r, m) in mixes)
        {
            var totals = Structures.Select(s => { var x = Run(s.Make, 1000, l, i, r, m); return x.Lk + x.Ins + x.Rg + x.Sm; }).ToArray();
            var cells = string.Join(", ", Structures.Select((s, x) => $"{s.Name} {totals[x]}"));
            Console.WriteLine($"{mix} ({l} lookups, {i} inserts, {r} ranges, {m} smallest) at n=1000: {cells}; fewest steps: {Structures[Fewest(totals)].Name}");
        }

        // Cache caveat: counts treat every step alike. If following a pointer costs 4 times an array step, the range-reports mix changes.
        var weighted = Structures.Select(s => { var x = Run(s.Make, 1000, 20, 5, 500, 0); return (x.Lk + x.Ins + x.Rg + x.Sm) * (s.Pointer == 2 ? 4 : 1); }).ToArray();
        Console.WriteLine("range reports at n=1000 with pointer steps weighted 4: " + string.Join(", ", Structures.Select((s, x) => $"{s.Name} {weighted[x]}")) + $"; fewest: {Structures[Fewest(weighted)].Name}");
    }
}
