// Indexing in C#: a full scan versus a sorted index with binary search.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    const int RowCount = 500_000; // rows in the demo table

    public static void Main()
    {
        var rows = Enumerable.Range(0, RowCount).Select(i => new Row(i, $"user{i}@example.com")).ToList();
        const string target = "user499999@example.com";

        Console.WriteLine("full scan comparisons: " + FullScan(rows, target));

        var emailIndex = new SortedIndex(rows); // built once; kept up to date on every write
        var (position, comparisons) = emailIndex.Find(target);
        Console.WriteLine($"index comparisons: {comparisons} -> row {rows[position].Id}");
    }

    static int FullScan(List<Row> rows, string email) // no index: read rows one by one
    {
        int comparisons = 0;
        foreach (var row in rows) { comparisons++; if (row.Email == email) break; }
        return comparisons;
    }
}

public record Row(int Id, string Email);

public class SortedIndex // the idea behind a B-tree index: sorted keys with pointers to rows
{
    private readonly (string Key, int Position)[] _entries;

    public SortedIndex(List<Row> table)
    {
        _entries = table.Select((row, position) => (row.Email, position)).ToArray();
        Array.Sort(_entries, (a, b) => string.CompareOrdinal(a.Key, b.Key));
    }

    public (int Position, int Comparisons) Find(string key) // binary search: each step discards half
    {
        int lo = 0, hi = _entries.Length - 1, comparisons = 0;
        while (lo <= hi)
        {
            int mid = (lo + hi) / 2;
            comparisons++;
            int cmp = string.CompareOrdinal(_entries[mid].Key, key);
            if (cmp == 0) return (_entries[mid].Position, comparisons);
            if (cmp < 0) lo = mid + 1; else hi = mid - 1;
        }
        return (-1, comparisons);
    }
}
