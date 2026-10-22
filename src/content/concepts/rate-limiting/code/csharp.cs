// A token bucket rate limiter in C#. The clock is passed in so the demo is deterministic.
using System;

public static class Program
{
    public static void Main()
    {
        const int Capacity = 3; // burst size in tokens
        const int RefillPerSecond = 1;
        double time = 0; // seconds, moved by hand
        var bucket = new TokenBucket(Capacity, RefillPerSecond, () => time);

        void Request(string label) =>
            Console.WriteLine($"t={time}s {label}: {(bucket.TryTake() ? "allowed" : "429 too many requests")}");

        foreach (var r in new[] { "r1", "r2", "r3", "r4" }) Request(r); // a burst of 4 at once: the 4th is rejected
        time = 1;
        Request("r5"); // one second later one token has refilled
        Request("r6"); // but only one
        time = 10;
        foreach (var r in new[] { "r7", "r8", "r9", "r10" }) Request(r); // a long pause refills only up to the capacity (3)
    }
}

public class TokenBucket
{
    private readonly double _capacity;
    private readonly double _refillPerSecond;
    private readonly Func<double> _now;
    private double _tokens;
    private double _last;

    public TokenBucket(double capacity, double refillPerSecond, Func<double> now)
    {
        _capacity = capacity;
        _refillPerSecond = refillPerSecond;
        _now = now;
        _tokens = capacity; // start full, so a new client can burst
        _last = now();
    }

    public bool TryTake()
    {
        var t = _now();
        // add the tokens earned since the last call, but never beyond the capacity
        _tokens = Math.Min(_capacity, _tokens + (t - _last) * _refillPerSecond);
        _last = t;
        if (_tokens >= 1)
        {
            _tokens -= 1;
            return true;
        }
        return false;
    }
}
