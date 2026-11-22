// A toy connection pool, simulated in whole seconds and milliseconds.
// A burst of B requests hits each of A app instances every `gap` seconds. Each instance keeps up to P connections.
// A new connection costs (1 TCP + tls) round trips before the request can be sent; a reused one costs nothing extra.
// The client closes a connection that has been idle for `clientIdle` seconds (0 means no reuse at all).
// The load balancer and server silently drop one idle for `remoteIdle` seconds; the client only finds out on its next send,
// which costs a wasted round trip (a reset) before it retries on a fresh connection: the "stale connection" error.
// The server accepts at most M connections in total; extra attempts are refused.
// Assumptions: RTT 40 ms, service time 20 ms, TLS 1.3 = 1 extra round trip, TLS 1.2 = 2. Real timeouts vary by product.
using System;
using System.Collections.Generic;
using System.Linq;

const int Rtt = 40, Service = 20, Bursts = 6;

string Run(int P, int A, int B, int gap, int clientIdle, int remoteIdle, int tls, int M)
{
    var pools = new List<List<int>>(); // last-used second of each connection
    for (int i = 0; i < A; i++) pools.Add(new List<int>());
    int served = 0, refused = 0, setups = 0, stale = 0, latSum = 0, latMax = 0, peak = 0;
    int slots = Math.Min(P, B);
    for (int k = 0; k < Bursts; k++)
    {
        int t = k * gap;
        for (int i = 0; i < A; i++) pools[i] = pools[i].Where(last => t - last < clientIdle).ToList(); // client closes idle ones cleanly
        int open = 0;
        foreach (var pool in pools) foreach (int last in pool) if (t - last < remoteIdle) open++;
        for (int i = 0; i < A; i++)
        {
            var pool = pools[i];
            for (int s = 0; s < slots; s++)
            {
                int n = (B - s + slots - 1) / slots; // requests that queue on this connection (ceiling)
                int cost = 0;
                if (s < pool.Count && t - pool[s] < remoteIdle) { /* live reuse */ }
                else
                {
                    if (s < pool.Count) { stale++; cost += Rtt; } // wasted send, then reset
                    if (open >= M) { refused += n; continue; }
                    open++; setups++; cost += (1 + tls) * Rtt;
                    if (s >= pool.Count) pool.Add(t);
                }
                pool[s] = t;
                for (int w = 0; w < n; w++)
                {
                    int lat = (w == 0 ? cost : 0) + (w + 1) * (Rtt + Service);
                    latSum += lat; latMax = Math.Max(latMax, lat); served++;
                }
            }
        }
        peak = Math.Max(peak, open);
    }
    int avg = served == 0 ? 0 : latSum / served;
    return $"served={served} refused={refused} new connections={setups} stale errors={stale} avg latency={avg} ms max latency={latMax} ms peak server connections={peak}";
}

Console.WriteLine($"new connection before first byte: TLS 1.3 {(1 + 1) * Rtt} ms, TLS 1.2 {(1 + 2) * Rtt} ms, reused 0 ms");
Console.WriteLine("no reuse, TLS 1.3:           " + Run(8, 4, 8, 30, 0, 60, 1, 100));
Console.WriteLine("no reuse, TLS 1.2:           " + Run(8, 4, 8, 30, 0, 60, 2, 100));
Console.WriteLine("pooled, busy (gap 30 s):     " + Run(8, 4, 8, 30, 50, 60, 1, 100));
Console.WriteLine("pooled, quiet, idle 90 > 60: " + Run(8, 4, 8, 70, 90, 60, 1, 100));
Console.WriteLine("pooled, quiet, idle 50 < 60: " + Run(8, 4, 8, 70, 50, 60, 1, 100));
Console.WriteLine("40 instances, pool 8:        " + Run(8, 40, 8, 30, 50, 60, 1, 100));
Console.WriteLine("40 instances, pool 2:        " + Run(2, 40, 8, 30, 50, 60, 1, 100));
