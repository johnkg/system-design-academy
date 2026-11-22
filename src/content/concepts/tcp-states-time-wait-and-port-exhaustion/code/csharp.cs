// Toy TCP connection-table models: who ends up in TIME_WAIT, how a single client-to-server pair runs out of source ports,
// how CLOSE_WAIT piles up when the application forgets to close, and how a small accept queue drops a burst.
// Assumptions: one tick is one second (one tick in the accept-queue model). Linux typically offers 28,232 ephemeral ports
// (32768 to 60999) and holds a closed connection in TIME_WAIT for 60 seconds; both vary by OS and settings.
// A connection is identified by (source IP, source port, destination IP, destination port); with one source IP talking to one
// destination address and port, only the source port can vary.
using System;
using System.Collections.Generic;
using System.Linq;

// Part 1: the states each side passes through, depending on who closes first.
(List<string>, List<string>) Lifecycle(string closer)
{
    var active = new List<string> { "ESTABLISHED", "FIN_WAIT_1", "FIN_WAIT_2", "TIME_WAIT", "CLOSED" };
    var passive = new List<string> { "ESTABLISHED", "CLOSE_WAIT", "LAST_ACK", "CLOSED" };
    var clientOpen = new List<string> { "SYN_SENT" };
    var serverOpen = new List<string> { "LISTEN", "SYN_RCVD" };
    return closer == "client"
        ? (clientOpen.Concat(active).ToList(), serverOpen.Concat(passive).ToList())
        : (clientOpen.Concat(passive).ToList(), serverOpen.Concat(active).ToList());
}
foreach (var closer in new[] { "client", "server" })
{
    var (c, s) = Lifecycle(closer);
    Console.WriteLine($"{closer} closes first: client {string.Join(" > ", c)} | server {string.Join(" > ", s)}");
}

// Part 2: one client IP making short connections to one server address and port.
const int Range = 28232, Seconds = 120;
string Ports(int rate, int twSeconds, string closer, int ips)
{
    int cap = Range * ips;
    var expiring = new int[Seconds + twSeconds + 1];
    int held = 0, ok = 0, failed = 0, peak = 0;
    for (int t = 0; t < Seconds; t++)
    {
        held -= expiring[t];
        int got = closer == "client" ? Math.Min(rate, cap - held) : rate; // only the closing side blocks its own ports
        held += got; ok += got; failed += rate - got;
        expiring[t + twSeconds] += got;
        peak = Math.Max(peak, held);
    }
    return $"connections ok={ok} failed (cannot assign address)={failed} peak TIME_WAIT on the closing side={peak}";
}
Console.WriteLine($"sustainable rate for one source IP: {Range / 60} new connections per second at 60 s TIME_WAIT");
Console.WriteLine("400/s, client closes:           " + Ports(400, 60, "client", 1));
Console.WriteLine("600/s, client closes:           " + Ports(600, 60, "client", 1));
Console.WriteLine("600/s, server closes:           " + Ports(600, 60, "server", 1));
Console.WriteLine("600/s, client, reuse after 1 s: " + Ports(600, 1, "client", 1));
Console.WriteLine("600/s, client, 2 source IPs:    " + Ports(600, 60, "client", 2));
Console.WriteLine("20/s, client closes (pooled):   " + Ports(20, 60, "client", 1));

// Part 3: a server that closes only on the success path. Each leaked connection stays in CLOSE_WAIT and holds a file descriptor.
string Leak(int perTick, int perMille, int limit)
{
    const int baseFds = 24; // descriptors used by the listening socket, logs and so on
    for (int t = 1; t <= 5000; t++)
    {
        int leaked = perTick * t * perMille / 1000;
        if (leaked + baseFds >= limit) return $"{perMille} per 1000 leak: descriptor limit {limit} reached at tick {t} with {leaked} connections stuck in CLOSE_WAIT";
    }
    return $"{perMille} per 1000 leak: limit not reached within 5000 ticks";
}
Console.WriteLine(Leak(100, 0, 1024));
Console.WriteLine(Leak(100, 5, 1024));
Console.WriteLine(Leak(100, 20, 1024));

// Part 4: accept queue. A burst of 30 connections arrives every third tick (10 per tick on average); the app accepts `rate` per tick.
string Accept(int queueSize, int rate)
{
    int queue = 0, dropped = 0, accepted = 0;
    for (int t = 0; t <= 20; t++)
    {
        int arrivals = t % 3 == 0 ? 30 : 0;
        int room = Math.Min(arrivals, queueSize - queue);
        queue += room; dropped += arrivals - room;
        int taken = Math.Min(rate, queue);
        queue -= taken; accepted += taken;
    }
    return $"queue {queueSize}, app accepts {rate}/tick: accepted={accepted} dropped={dropped}";
}
Console.WriteLine(Accept(8, 10));
Console.WriteLine(Accept(32, 10));
Console.WriteLine(Accept(32, 5));
