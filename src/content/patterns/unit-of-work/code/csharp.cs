// Unit of Work in C#. Changes are remembered, then saved together or not at all.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        var store = new Store();

        var first = new UnitOfWork(store);
        first.Set("order:1", "paid");
        first.Set("stock:apple", "9");
        first.Set("points:ada", "15");
        first.Commit();
        Console.WriteLine($"Store: {store.Show()}");

        var second = new UnitOfWork(store);
        second.Set("order:2", "paid");
        second.Set("stock:apple", "8");
        second.Set("points:ada", "lots"); // the store rejects this one
        second.Commit();
        Console.WriteLine($"Store: {store.Show()}");
    }
}

public class Store // Data store: rejects a bad value, and can restore an earlier state
{
    private Dictionary<string, string> _data = new();

    public void Write(string key, string value)
    {
        if (key.StartsWith("points:") && !value.All(char.IsDigit)) throw new InvalidOperationException("points must be a number");
        _data[key] = value;
    }

    public Dictionary<string, string> Snapshot() => new(_data);
    public void Restore(Dictionary<string, string> snapshot) => _data = snapshot;

    public string Show() =>
        string.Join(", ", _data.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => $"{p.Key}={p.Value}"));
}

public class UnitOfWork(Store store)
{
    private readonly Dictionary<string, string> _changes = new();

    public void Set(string key, string value) => _changes[key] = value; // remembered, not written yet

    public void Commit()
    {
        var before = store.Snapshot();
        var count = _changes.Count;
        try
        {
            foreach (var (key, value) in _changes) store.Write(key, value);
            Console.WriteLine($"Committed {count} changes");
        }
        catch (InvalidOperationException error)
        {
            store.Restore(before);
            Console.WriteLine($"Rolled back after a failed write: {error.Message}");
        }
        finally
        {
            _changes.Clear();
        }
    }
}
