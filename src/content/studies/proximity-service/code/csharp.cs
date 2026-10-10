// Places within a radius, in C#:
// places are sorted by the Z-order key of their cell (the idea behind a geohash), so each grid cell is one contiguous range of the sorted list.
// A radius search reads the query's cell and its 8 neighbours, then measures the true distance of only those candidates.
using System;
using System.Collections.Generic;
using System.Linq;

public record Place(int X, int Y, int Key);
public record Found(int Hits, int Examined, int Lookups, int CellWidth);

public static class Program
{
    const int Bits = 12, Size = 1 << Bits;          // a 4096 by 4096 map; one unit is 10 metres, so the map is about 41 km wide
    static long seed = 99;
    static int Random(int n) { seed = (seed * 1664525 + 1013904223) % 4294967296; return (int)(seed / 65536 % n); }

    // Z-order key: interleave the bits of x and y, most significant first. Cells that share a prefix are nested squares.
    static int ZKey(int x, int y) { int k = 0; for (int b = Bits - 1; b >= 0; b--) k = k * 4 + (((x >> b) & 1) * 2 + ((y >> b) & 1)); return k; }

    static readonly List<Place> places = new();
    static void Add(int x, int y) { x = Math.Min(Size - 1, Math.Max(0, x)); y = Math.Min(Size - 1, Math.Max(0, y)); places.Add(new Place(x, y, ZKey(x, y))); }
    static long Dist2(Place p, int qx, int qy) => (long)(p.X - qx) * (p.X - qx) + (long)(p.Y - qy) * (p.Y - qy);

    // First index whose key is at least the given key (binary search).
    static int LowerBound(int key)
    {
        int lo = 0, hi = places.Count;
        while (lo < hi) { int mid = (lo + hi) >> 1; if (places[mid].Key < key) lo = mid + 1; else hi = mid; }
        return lo;
    }

    // The cell is the smallest power-of-two square at least as wide as the radius, so the circle reaches at most one cell away.
    static Found Search(int qx, int qy, int r, bool neighbours)
    {
        int s = 0; while ((1 << s) < r) s++;
        int cx = qx >> s, cy = qy >> s, cells = Size >> s, reach = neighbours ? 1 : 0;
        int hits = 0, examined = 0, lookups = 0;
        for (int dx = -reach; dx <= reach; dx++) for (int dy = -reach; dy <= reach; dy++)
        {
            int x = cx + dx, y = cy + dy;
            if (x < 0 || y < 0 || x >= cells || y >= cells) continue;
            int lo = ZKey(x << s, y << s), hi = lo + (1 << (2 * s)); lookups++;
            for (int i = LowerBound(lo); i < places.Count && places[i].Key < hi; i++)
            {
                examined++;
                if (Dist2(places[i], qx, qy) <= (long)r * r) hits++;
            }
        }
        return new Found(hits, examined, lookups, 1 << s);
    }

    static int BruteForce(int qx, int qy, int r) => places.Count(p => Dist2(p, qx, qy) <= (long)r * r);

    public static int Main()
    {
        for (int i = 0; i < 3000; i++) Add(1200 + Random(300) + Random(300) - 300, 1200 + Random(300) + Random(300) - 300); // a dense city
        for (int i = 0; i < 400; i++) Add(3000 + Random(100) + Random(100) - 100, 2800 + Random(100) + Random(100) - 100);  // a small town
        for (int i = 0; i < 600; i++) Add(Random(Size), Random(Size));                                                      // places everywhere else
        places.Sort((a, b) => a.Key != b.Key ? a.Key.CompareTo(b.Key) : a.X != b.X ? a.X.CompareTo(b.X) : a.Y.CompareTo(b.Y));

        // One query in the city, 20 units from a cell edge, with a radius of 1.5 km.
        int qx = 1260, qy = 1230, r = 150;
        int truth = BruteForce(qx, qy, r); var own = Search(qx, qy, r, false); var nine = Search(qx, qy, r, true);
        Console.WriteLine($"{places.Count} places; cells are {nine.CellWidth} units wide for a radius of {r}");
        Console.WriteLine($"full scan: {truth} results, {places.Count} examined");
        Console.WriteLine($"own cell only: {own.Hits} results, {own.Examined} examined, {own.Lookups} lookup");
        Console.WriteLine($"cell and 8 neighbours: {nine.Hits} results, {nine.Examined} examined, {nine.Lookups} lookups");

        // 300 queries all over the map with radii from 40 to 240 units.
        int total = 0, ownTotal = 0, nineTotal = 0, examined = 0; bool exact = true;
        for (int i = 0; i < 300; i++)
        {
            int x = Random(Size), y = Random(Size), radius = 40 + Random(201);
            int t = BruteForce(x, y, radius); var a = Search(x, y, radius, false); var b = Search(x, y, radius, true);
            total += t; ownTotal += a.Hits; nineTotal += b.Hits; examined += b.Examined;
            if (b.Hits != t) exact = false;
        }
        Console.WriteLine($"300 queries: {total} results, own cell found {ownTotal}, with neighbours found {nineTotal}, examined {examined} instead of {300 * places.Count}");
        return !exact || own.Hits >= truth || nine.Hits != truth || ownTotal >= total || examined >= 300 * places.Count ? 1 : 0;
    }
}
