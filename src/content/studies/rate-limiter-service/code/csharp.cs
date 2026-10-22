// Three rate limiting algorithms in C#, tried on a burst that straddles a window boundary.
// Limit: 10 requests per second. Times are in milliseconds and passed in, so the demo is deterministic.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    public const int MsPerS = 1000;
    const int Limit = 10, WindowMs = 1000;
    const int Burst = 10, GapMs = 10, LateBurstAt = 2900, EarlyBurstAt = 3000; // two bursts around the 3 s boundary
    const int Gateways = 3;

    public static void Main()
    {
        // 10 requests in the last 100 ms of one second, and 10 more in the first 100 ms of the next
        var times = new List<long>();
        for (var k = 0; k < Burst; k++) times.Add(LateBurstAt + k * GapMs);
        for (var k = 0; k < Burst; k++) times.Add(EarlyBurstAt + k * GapMs);

        void Run(string name, Func<long, bool> allow)
        {
            var allowed = times.Where(t => allow(t)).ToList();
            var worst = allowed.Max(t => allowed.Count(u => u >= t && u < t + MsPerS));
            Console.WriteLine($"{name}: allowed {allowed.Count} of {times.Count}, most in any 1 s: {worst}");
        }

        var fixedWindow = new FixedWindow(Limit, WindowMs);
        Run("fixed window     ", fixedWindow.Allow);
        var log = new SlidingWindowLog(Limit, WindowMs);
        Run("sliding log      ", log.Allow);
        var bucket = new TokenBucket(Limit, Limit);
        Run("token bucket     ", bucket.Allow);

        // Three gateways that each count on their own (the first attempt): requests rotate between them
        var gateways = Enumerable.Range(0, Gateways).Select(_ => new FixedWindow(Limit, WindowMs)).ToArray();
        var turn = 0;
        Run("3 separate gates ", t => gateways[turn++ % Gateways].Allow(t));
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
        _tokens = Math.Min(_capacity, _tokens + ((t - _last) / (double)Program.MsPerS) * _refillPerSecond);
        _last = t;
        if (_tokens < 1) return false;
        _tokens -= 1;
        return true;
    }
}
