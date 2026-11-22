// A plain binary search tree against an AVL tree (a BST that rotates to stay balanced), counted in key comparisons, never in time.
// Keys are inserted in three orders: sorted, random (a fixed shuffle) and zigzag (smallest, largest, next smallest, ...).
// Look for: the plain BST on sorted or zigzag input is a list in disguise (height n, about n^2/2 comparisons); the AVL tree
// keeps its height near log2(n) on every order, and pays with a few rotations. The last lines count levels of a B-tree by fanout.
// The plain BST is built with loops (a degenerate tree is as deep as it is long); the AVL tree uses recursion, which stays shallow.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    static List<int> MakeKeys(string order, int n)
    {
        var keys = new List<int>();
        if (order == "sorted") for (int i = 1; i <= n; i++) keys.Add(i);
        else if (order == "zigzag") { int lo = 1, hi = n; while (lo <= hi) { keys.Add(lo++); if (lo <= hi) keys.Add(hi--); } }
        else
        {
            for (int i = 1; i <= n; i++) keys.Add(i);
            uint x = 12345;
            for (int i = n - 1; i > 0; i--)
            {
                unchecked { x = x * 1664525 + 1013904223; }
                int j = (int)((x >> 16) % (uint)(i + 1));
                int t = keys[i]; keys[i] = keys[j]; keys[j] = t;
            }
        }
        return keys;
    }

    // Both trees store nodes in lists: key, left, right (-1 means no child), height for the AVL tree.
    static (long height, long lookups, long comparisons, long rotations) PlainBst(List<int> keys)
    {
        var key = new List<int>(); var left = new List<int>(); var right = new List<int>();
        long comparisons = 0; int root = -1;
        foreach (int k in keys)
        {
            key.Add(k); left.Add(-1); right.Add(-1);
            int id = key.Count - 1;
            if (root < 0) { root = id; continue; }
            int at = root;
            for (;;)
            {
                comparisons++;
                var side = k < key[at] ? left : right;
                if (side[at] < 0) { side[at] = id; break; }
                at = side[at];
            }
        }
        var m = Measure(root, left, right);
        return (m.height, m.lookups, comparisons, 0);
    }

    static (long height, long lookups, long comparisons, long rotations) AvlTree(List<int> keys)
    {
        var key = new List<int>(); var left = new List<int>(); var right = new List<int>(); var height = new List<int>();
        long comparisons = 0, rotations = 0;
        Func<int, int> h = (id) => id < 0 ? 0 : height[id];
        Action<int> fix = (id) => { height[id] = 1 + Math.Max(h(left[id]), h(right[id])); };
        Func<int, int> rotateRight = (y) => { int x = left[y]; left[y] = right[x]; right[x] = y; fix(y); fix(x); rotations++; return x; };
        Func<int, int> rotateLeft = (x) => { int y = right[x]; right[x] = left[y]; left[y] = x; fix(x); fix(y); rotations++; return y; };
        Func<int, int, int> insert = null;
        insert = (at, id) =>
        {
            if (at < 0) return id;
            comparisons++;
            if (key[id] < key[at]) left[at] = insert(left[at], id); else right[at] = insert(right[at], id);
            fix(at);
            int balance = h(left[at]) - h(right[at]);
            if (balance > 1) { if (h(left[left[at]]) < h(right[left[at]])) left[at] = rotateLeft(left[at]); return rotateRight(at); }
            if (balance < -1) { if (h(right[right[at]]) < h(left[right[at]])) right[at] = rotateRight(right[at]); return rotateLeft(at); }
            return at;
        };
        int root = -1;
        foreach (int k in keys)
        {
            key.Add(k); left.Add(-1); right.Add(-1); height.Add(1);
            root = insert(root, key.Count - 1);
        }
        var m = Measure(root, left, right);
        return (m.height, m.lookups, comparisons, rotations);
    }

    // Height and the sum of (depth + 1) over all nodes: looking every key up once costs exactly that many comparisons.
    static (long height, long lookups) Measure(int root, List<int> left, List<int> right)
    {
        long height = 0, lookups = 0;
        var stack = new Stack<(int id, int depth)>();
        stack.Push((root, 1));
        while (stack.Count > 0)
        {
            var (id, depth) = stack.Pop();
            if (id < 0) continue;
            height = Math.Max(height, depth);
            lookups += depth;
            stack.Push((left[id], depth + 1));
            stack.Push((right[id], depth + 1));
        }
        return (height, lookups);
    }

    static string Hundredths(long a, long b)
    {
        long v = (a * 100) / b;
        return $"{v / 100}.{(v % 100).ToString().PadLeft(2, '0')}";
    }

    static int Levels(long n, long fanout) // smallest h such that a full tree of height h holds n keys: fanout^h - 1 >= n
    {
        int h = 0; long capacity = 1;
        while (capacity - 1 < n) { capacity *= fanout; h++; }
        return h;
    }

    public static void Main()
    {
        foreach (int n in new[] { 10, 100, 1000, 10000 })
        {
            Console.WriteLine($"n={n}");
            foreach (var order in new[] { "sorted", "zigzag", "random" })
            {
                var keys = MakeKeys(order, n);
                var a = PlainBst(keys); var b = AvlTree(keys);
                Console.WriteLine($"  {order}: plain BST height {a.height}, {a.comparisons} comparisons to build, {Hundredths(a.lookups, n)} per lookup; AVL height {b.height}, {b.comparisons} comparisons, {b.rotations} rotations, {Hundredths(b.lookups, n)} per lookup");
            }
        }
        foreach (long n in new long[] { 1000000, 1000000000 })
            Console.WriteLine($"levels to hold {n} keys: " + string.Join(", ", new long[] { 2, 100, 500 }.Select(f => $"fanout {f}: {Levels(n, f)}")));
    }
}
