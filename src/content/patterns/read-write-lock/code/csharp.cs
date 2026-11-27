// Read-Write Lock in C#. .NET has ReaderWriterLockSlim; this models the lock's rules with try-style calls
// so that the output is the same on every run. Real code blocks instead of returning false.
using System;

public static class Program
{
    private static readonly ReadWriteLock Lock = new();
    private static int _version = 1; // Shared data

    private static void Read(string name)
    {
        if (!Lock.TryRead()) { Console.WriteLine($"{name} must wait (writer active)"); return; }
        Console.WriteLine($"{name} acquired (readers: {Lock.Readers}), sees version {_version}");
    }

    private static void Release(string name)
    {
        Lock.ReleaseRead();
        Console.WriteLine($"{name} released (readers: {Lock.Readers})");
    }

    public static void Main()
    {
        Read("reader 1");
        Read("reader 2");
        if (!Lock.TryWrite()) Console.WriteLine($"writer must wait (readers: {Lock.Readers})");
        Release("reader 1");
        Release("reader 2");
        if (Lock.TryWrite()) { _version = 2; Console.WriteLine("writer acquired (exclusive), set version 2"); }
        Read("reader 3");
        Lock.ReleaseWrite();
        Console.WriteLine("writer released");
        Read("reader 3");
    }
}

// Illustration only: this class is NOT thread-safe. It models the rules; use ReaderWriterLockSlim as a real lock.
public class ReadWriteLock
{
    private bool _writer;
    public int Readers { get; private set; }

    public bool TryRead() // many readers may enter together, unless a writer is inside
    {
        if (_writer) return false;
        Readers++;
        return true;
    }

    public void ReleaseRead() => Readers--;

    public bool TryWrite() // a writer needs the lock to itself
    {
        if (_writer || Readers > 0) return false;
        _writer = true;
        return true;
    }

    public void ReleaseWrite() => _writer = false;
}
