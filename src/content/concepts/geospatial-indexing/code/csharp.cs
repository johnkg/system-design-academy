// Geospatial indexing: find restaurants within 2 km with a geohash index, compared with a full scan.
// Restaurants are generated around central Berlin with an integer generator, so every run prints the same.
// The index maps each 5-character geohash (a cell about 3.0 km wide and 4.9 km tall at this latitude) to its restaurants.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

public static class Program
{
    const string Base32 = "0123456789bcdefghjkmnpqrstuvwxyz";
    const double EarthRadiusM = 6371000;
    const int CityLatE6 = 52520000, CityLngE6 = 13405000; // micro-degrees
    const int Count = 600, Precision = 5, RadiusM = 2000;
    const double UserLat = 52.5175, UserLng = 13.4170; // a few hundred metres from a cell edge

    static long seed = 2024; // Park-Miller generator, integers only so every language prints the same
    static int NextRand(int n)
    {
        seed = (seed * 48271) % 2147483647;
        return (int)(seed % n);
    }

    record Place(int Id, double Lat, double Lng, string Cell);

    static string Encode(double lat, double lng, int precision)
    {
        // Interleave longitude and latitude bits (longitude first), 5 bits per base-32 character.
        double latLo = -90, latHi = 90, lngLo = -180, lngHi = 180;
        var hash = "";
        int bits = 0, value = 0;
        bool evenBit = true;
        while (hash.Length < precision)
        {
            if (evenBit)
            {
                double mid = (lngLo + lngHi) / 2;
                if (lng >= mid) { value = value * 2 + 1; lngLo = mid; } else { value = value * 2; lngHi = mid; }
            }
            else
            {
                double mid = (latLo + latHi) / 2;
                if (lat >= mid) { value = value * 2 + 1; latLo = mid; } else { value = value * 2; latHi = mid; }
            }
            evenBit = !evenBit;
            if (++bits == 5) { hash += Base32[value]; bits = 0; value = 0; }
        }
        return hash;
    }

    static (double LatLo, double LatHi, double LngLo, double LngHi) Bounds(string hash)
    {
        // The rectangle a geohash stands for.
        double latLo = -90, latHi = 90, lngLo = -180, lngHi = 180;
        bool evenBit = true;
        foreach (char ch in hash)
        {
            int v = Base32.IndexOf(ch);
            for (int b = 4; b >= 0; b--)
            {
                int bit = (v >> b) & 1;
                if (evenBit) { double mid = (lngLo + lngHi) / 2; if (bit == 1) lngLo = mid; else lngHi = mid; }
                else { double mid = (latLo + latHi) / 2; if (bit == 1) latLo = mid; else latHi = mid; }
                evenBit = !evenBit;
            }
        }
        return (latLo, latHi, lngLo, lngHi);
    }

    static List<string> CellAndNeighbours(string hash)
    {
        // Step one cell height or width from the centre of this cell in each of the 8 directions (no pole or date-line wrap).
        var (latLo, latHi, lngLo, lngHi) = Bounds(hash);
        double h = latHi - latLo, w = lngHi - lngLo, cLat = (latLo + latHi) / 2, cLng = (lngLo + lngHi) / 2;
        var outList = new List<string>();
        foreach (int dy in new[] { -1, 0, 1 })
            foreach (int dx in new[] { -1, 0, 1 })
                outList.Add(Encode(cLat + dy * h, cLng + dx * w, hash.Length));
        return outList;
    }

    static double HaversineM(double lat1, double lng1, double lat2, double lng2)
    {
        double rad = Math.PI / 180;
        double dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
        double a = Math.Pow(Math.Sin(dLat / 2), 2) + Math.Cos(lat1 * rad) * Math.Cos(lat2 * rad) * Math.Pow(Math.Sin(dLng / 2), 2);
        return 2 * EarthRadiusM * Math.Asin(Math.Sqrt(a));
    }

    static Dictionary<string, List<Place>> index = new();

    static (int Checked, List<Place> Found) Search(IEnumerable<string> cells)
    {
        var candidates = cells.SelectMany(c => index.TryGetValue(c, out var list) ? list : new List<Place>()).ToList();
        var found = candidates.Where(p => HaversineM(UserLat, UserLng, p.Lat, p.Lng) <= RadiusM).ToList();
        return (candidates.Count, found);
    }

    static string Num(double v) => v.ToString(CultureInfo.InvariantCulture);

    public static void Main()
    {
        // 70% of the restaurants within about 2 km of the centre, the rest spread over about 9 km.
        var places = new List<Place>();
        for (int i = 0; i < Count; i++)
        {
            bool dense = NextRand(10) < 7;
            int latSpan = dense ? 20000 : 80000, lngSpan = dense ? 33000 : 130000;
            double lat = (CityLatE6 + NextRand(2 * latSpan + 1) - latSpan) / 1e6;
            double lng = (CityLngE6 + NextRand(2 * lngSpan + 1) - lngSpan) / 1e6;
            places.Add(new Place(i, lat, lng, Encode(lat, lng, Precision)));
        }

        // The index: geohash cell -> restaurants. In Redis or a database this is an ordinary sorted key.
        var order = new List<string>(); // keep first-seen order, like the other languages
        foreach (var p in places)
        {
            if (!index.ContainsKey(p.Cell)) { index[p.Cell] = new List<Place>(); order.Add(p.Cell); }
            index[p.Cell].Add(p);
        }

        string userCell = Encode(UserLat, UserLng, Precision);
        Console.WriteLine($"self-check: encode(57.64911, 10.40744, 11) = {Encode(57.64911, 10.40744, 11)}");
        Console.WriteLine($"user at {Num(UserLat)}, {Num(UserLng)} -> cell {userCell}, longer prefix {Encode(UserLat, UserLng, 7)}");
        for (int p = 4; p <= 7; p++)
        {
            var (latLo, latHi, lngLo, lngHi) = Bounds(Encode(UserLat, UserLng, p));
            double tall = (latHi - latLo) * 111320, wide = (lngHi - lngLo) * 111320 * Math.Cos(UserLat * Math.PI / 180);
            Console.WriteLine($"precision {p}: cell about {Math.Floor(wide + 0.5)} m wide x {Math.Floor(tall + 0.5)} m tall");
        }
        Console.WriteLine($"{Count} restaurants in {index.Count} cells of precision {Precision}");

        var scan = Search(order);
        var own = Search(new[] { userCell });
        var nine = Search(CellAndNeighbours(userCell));
        int total = scan.Found.Count;
        foreach (var (name, r) in new[] { ("full scan", scan), ("own cell only", own), ("cell + 8 neighbours", nine) })
            Console.WriteLine($"{name.PadRight(20)} checked={r.Checked,3} found={r.Found.Count,3} missed={total - r.Found.Count}");
        Console.WriteLine($"neighbour cells: {string.Join(" ", CellAndNeighbours(userCell))}");

        var nearest = nine.Found
            .Select(p => (p, d: HaversineM(UserLat, UserLng, p.Lat, p.Lng)))
            .OrderBy(t => t.d).ThenBy(t => t.p.Id)
            .Take(3);
        foreach (var (p, d) in nearest) Console.WriteLine($"restaurant {p.Id} in {p.Cell}: {Math.Floor(d + 0.5)} m");
    }
}
