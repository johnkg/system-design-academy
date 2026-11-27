// Without the pattern: one plain lock, so readers take turns even though reading changes nothing.
using System;

public static class Program
{
    private static bool _held;

    private static bool TryLock()
    {
        if (_held) return false;
        _held = true;
        return true;
    }

    private static void Read(string name)
    {
        if (!TryLock()) { Console.WriteLine($"{name} must wait (lock is held)"); return; }
        Console.WriteLine($"{name} acquired");
    }

    private static void Release(string name)
    {
        _held = false;
        Console.WriteLine($"{name} released");
    }

    public static void Main()
    {
        Read("reader 1");
        Read("reader 2"); // blocked, although reader 1 only reads
        Release("reader 1");
        Read("reader 2");
        Release("reader 2");
    }
}
