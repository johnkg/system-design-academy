// Three rate limiting algorithms in C#, tried on a burst that straddles a window boundary.
// Limit: 10 requests per second. Times are in milliseconds and passed in, so the demo is deterministic.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        // 10 requests in the last 100 ms of one second, and 10 more in the first 100 ms of the next
        var times = new List<long>();
        for (var k = 0; k < 10; k++) times.Add(2900 + k * 10);
        for (var k = 0; k < 10; k++) times.Add(3000 + k * 10);

        void Run(string name, Func<long, bool> allow)
        {
            var allowed = times.Where(t => allow(t)).ToList();
            var worst = allowed.Max(t => allowed.Count(u => u >= t && u < t + 1000));
            Console.WriteLine($"{name}: allowed {allowed.Count} of {times.Count}, most in any 1 s: {worst}");
        }

        var fixedWindow = new FixedWindow(10, 1000);
        Run("fixed window     ", fixedWindow.Allow);
        var log = new SlidingWindowLog(10, 1000);
        Run("sliding log      ", log.Allow);
        var bucket = new TokenBucket(10, 10);
        Run("token bucket     ", bucket.Allow);

        // Three gateways that each count on their own (the first attempt): requests rotate between them
        var gateways = new[] { new FixedWindow(10, 1000), new FixedWindow(10, 1000), new FixedWindow(10, 1000) };
        var turn = 0;
        Run("3 separate gates ", t => gateways[turn++ % 3].Allow(t));
    }
}

public class FixedWindow(int limit, long windowMs)
{
    private long _window = -1;
    private int _count;
    public bool Allow(long t)
    {
        var window = t / windowMs;
        if (window != _window) { _window = window; _count = 0; } // a new window starts a new count
        if (_count >= limit) return false;
        _count++;
        return true;
    }
}

public class SlidingWindowLog(int limit, long windowMs)
{
    private readonly Queue<long> _times = new();
    public bool Allow(long t)
    {
        while (_times.Count > 0 && _times.Peek() <= t - windowMs) _times.Dequeue(); // forget old requests
        if (_times.Count >= limit) return false;
        _times.Enqueue(t);
        return true;
    }
}

public class TokenBucket
{
    private readonly double _capacity;
    private readonly double _refillPerSecond;
    private double _tokens;
    private long _last;

    public TokenBucket(double capacity, double refillPerSecond)
    {
        _capacity = capacity;
        _refillPerSecond = refillPerSecond;
        _tokens = capacity;
    }

    public bool Allow(long t)
    {
        _tokens = Math.Min(_capacity, _tokens + ((t - _last) / 1000.0) * _refillPerSecond);
        _last = t;
        if (_tokens < 1) return false;
        _tokens -= 1;
        return true;
    }
}
