// A grid index for finding the nearest driver in C#:
// drivers are filed under the grid cell they are in, so a search only looks at nearby cells instead of every driver.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

public record Point(double X, double Y);
public record Driver(int Id, double X, double Y);
public record Found(Driver? Driver, double Distance, int Examined);

public class DriverIndex
{
    const int MaxRing = 50; // give up after this many rings
    const double Cell = 2; // cell size, in the same units as the coordinates (think of 2 km)
    readonly Dictionary<(int, int), Dictionary<int, Driver>> cells = new();
    readonly Dictionary<int, (int, int)> where = new(); // driver id -> the cell it is filed under

    public static (int, int) CellOf(double x, double y) => ((int)Math.Floor(x / Cell), (int)Math.Floor(y / Cell));
    public static double Distance(Point a, Driver b) => Math.Sqrt((a.X - b.X) * (a.X - b.X) + (a.Y - b.Y) * (a.Y - b.Y));

    public IEnumerable<Driver> All() => cells.Values.SelectMany(c => c.Values);

    // Called for every location update: move the driver to the right cell if it changed.
    public void Update(Driver driver)
    {
        var key = CellOf(driver.X, driver.Y);
        if (where.TryGetValue(driver.Id, out var old) && old != key) cells[old].Remove(driver.Id);
        if (!cells.ContainsKey(key)) cells[key] = new Dictionary<int, Driver>();
        where[driver.Id] = key;
        cells[key][driver.Id] = driver;
    }

    // Search ring by ring around the rider's cell. Ring 0 is the rider's own cell, ring 1 the 8 cells around it, and so on.
    // Every cell in ring k is at least (k - 1) * Cell away, so once the best driver found is closer than that, stop.
    public Found Nearest(Point rider, int maxRing = MaxRing)
    {
        var (cx, cy) = CellOf(rider.X, rider.Y);
        Driver? best = null;
        double bestDistance = double.PositiveInfinity;
        int examined = 0;
        for (int k = 0; k <= maxRing; k++)
        {
            if (best != null && (k - 1) * Cell >= bestDistance) break;
            for (int dx = -k; dx <= k; dx++)
            {
                for (int dy = -k; dy <= k; dy++)
                {
                    if (Math.Max(Math.Abs(dx), Math.Abs(dy)) != k) continue; // only the cells on the edge of this ring
                    if (!cells.TryGetValue((cx + dx, cy + dy), out var cell)) continue;
                    foreach (var driver in cell.Values)
                    {
                        examined++;
                        double d = Distance(rider, driver);
                        if (d < bestDistance) { best = driver; bestDistance = d; }
                    }
                }
            }
        }
        return new Found(best, bestDistance, examined);
    }
}

public static class Program
{
    public static int Main()
    {
        // A reproducible set of 2,000 drivers on a 100 x 100 map.
        const int Seed = 42, Drivers = 2000, MapSize = 100, Move = 5; // Move is enough to cross a cell boundary
        long seed = Seed;
        // Linear congruential generator (Numerical Recipes constants), scaled to [0, 1).
        double NextRandom() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296.0; }
        var drivers = Enumerable.Range(0, Drivers).Select(i => new Driver(i, NextRandom() * MapSize, NextRandom() * MapSize)).ToList();

        var index = new DriverIndex();
        foreach (var d in drivers) index.Update(d);

        // A driver moves across a cell boundary: the next update files them under the new cell.
        index.Update(new Driver(0, drivers[0].X + Move, drivers[0].Y));

        int mismatches = 0;
        foreach (var rider in new[] { new Point(50, 50), new Point(1.9, 99.9), new Point(21.99, 21.99) })
        {
            var found = index.Nearest(rider);
            // Check against the slow way, which looks at every driver.
            var truth = index.All().OrderBy(d => DriverIndex.Distance(rider, d)).First();
            bool same = found.Driver!.Id == truth.Id;
            if (!same) mismatches++;
            string f(double v) => v.ToString("0.00", CultureInfo.InvariantCulture);
            Console.WriteLine($"rider ({rider.X.ToString(CultureInfo.InvariantCulture)}, {rider.Y.ToString(CultureInfo.InvariantCulture)})  nearest driver {found.Driver.Id} at {f(found.Distance)}  looked at {found.Examined} of 2000 drivers  {(same ? "matches" : "DIFFERS from")} the full scan");
        }
        return mismatches > 0 ? 1 : 0;
    }
}
