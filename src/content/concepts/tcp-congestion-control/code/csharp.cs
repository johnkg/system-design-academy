// A round-by-round model of TCP Reno (slow start + AIMD) on a fixed-capacity link.
// One loop iteration = one round trip: the sender puts cwnd segments in flight.
// All integer arithmetic, a seeded Park-Miller generator, no clock.
using System;
using System.Collections.Generic;

const long MSS = 1460, InitialWindow = 10;

(long bdp, long total, int rounds, long timeMs, long retransmits, List<string> trace) Transfer(
    long fileBytes, long mbps, long rttMs, long bufferSegs, long lossPer10k, long seed)
{
    long bdp = (mbps * 125 * rttMs) / MSS; // bytes per RTT / MSS = segments needed in flight to fill the link
    long total = (fileBytes + MSS - 1) / MSS;
    long rngState = seed;
    long Rng() { rngState = (rngState * 48271) % 2147483647; return rngState; }
    long cwnd = InitialWindow, ssthresh = 1000000000;
    long remaining = total, delivered = 0, timeMs = 0, retransmits = 0;
    var trace = new List<string>();
    while (remaining > 0)
    {
        long sent = Math.Min(cwnd, remaining);
        long overflow = Math.Max(0, sent - bdp - bufferSegs); // queue full: tail drop
        long random = 0;
        for (long i = 0; i < sent; i++) if (Rng() % 10000 < lossPer10k) random++;
        long lost = Math.Min(sent, overflow + random);
        // Invariant: more than BDP + buffer in flight cannot fit, so a loss event must follow.
        if (sent > bdp + bufferSegs && lost == 0) throw new Exception("window above BDP+buffer without a loss");
        long queue = Math.Min(Math.Max(sent - bdp, 0), bufferSegs);
        long roundMs = rttMs + (queue * rttMs) / bdp; // a standing queue inflates the RTT
        trace.Add(cwnd + (lost > 0 ? "*" : ""));
        remaining -= sent - lost; // lost segments stay in "remaining" and are sent again
        delivered += sent - lost;
        retransmits += lost;
        if (lost > 0)
        {
            ssthresh = Math.Max(2, cwnd / 2);
            if (sent - lost < 4) { cwnd = 1; roundMs += Math.Max(200, 3 * rttMs); } // too few dup ACKs: timeout
            else cwnd = ssthresh;                                                   // fast retransmit + fast recovery
        }
        else if (cwnd < ssthresh) cwnd = Math.Min(cwnd * 2, ssthresh); // slow start: double per RTT
        else cwnd += 1;                                               // congestion avoidance: +1 per RTT
        timeMs += roundMs;
    }
    if (delivered != total) throw new Exception("transfer incomplete");
    return (bdp, total, trace.Count, timeMs, retransmits, trace);
}

foreach (var (name, loss) in new[] { ("clean link", 0L), ("0.1% random loss", 10L), ("1% random loss", 100L) })
{
    var r = Transfer(5000000, 100, 80, 684, loss, 7); // buffer = 1 BDP
    Console.WriteLine($"{name}: BDP={r.bdp} segments, file={r.total} segments");
    Console.WriteLine($"  cwnd per round: {string.Join(" ", r.trace.GetRange(0, Math.Min(14, r.rounds)))}{(r.rounds > 14 ? " ..." : "")}");
    Console.WriteLine($"  rounds={r.rounds} time={r.timeMs} ms retransmits={r.retransmits}");
}
Console.WriteLine($"ideal time at line rate: {(5000000 * 8) / 100000} ms"); // 100 Mbit/s = 100000 bits per ms
