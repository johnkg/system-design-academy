// A round-by-round model of TCP Reno (slow start + AIMD) on a fixed-capacity link.
// One loop iteration = one round trip: the sender puts cwnd segments in flight.
// All integer arithmetic, a seeded Park-Miller generator, no clock.
using System;
using System.Collections.Generic;

const long MSS = 1460, InitialWindow = 10;
const long BytesPerMsPerMbps = 125; // 1 Mbit/s carries 125 bytes per millisecond
const long InitialSsthresh = 1000000000; // effectively unlimited: slow start until the first loss
const long LossScale = 10000; // loss rates are per 10,000 segments
const long MinForFastRetransmit = 4; // fewer segments than this cannot produce 3 duplicate ACKs
const long MinRtoMs = 200;
const long RtoRtts = 3; // a timeout costs max(MinRtoMs, RtoRtts * RTT)
const long FileBytes = 5000000; // demo: 5 MB over 100 Mbit/s with 80 ms RTT, buffer = 1 BDP
const long LinkMbps = 100;
const long RttMs = 80;
const long BufferSegments = 684;
const long Seed = 7;

(long bdp, long total, int rounds, long timeMs, long retransmits, List<string> trace) Transfer(
    long fileBytes, long mbps, long rttMs, long bufferSegs, long lossPer10k, long seed)
{
    long bdp = (mbps * BytesPerMsPerMbps * rttMs) / MSS; // bytes per RTT / MSS = segments needed in flight to fill the link
    long total = (fileBytes + MSS - 1) / MSS;
    long rngState = seed;
    long Rng() { rngState = (rngState * 48271) % 2147483647; return rngState; }
    long cwnd = InitialWindow, ssthresh = InitialSsthresh;
    long remaining = total, delivered = 0, timeMs = 0, retransmits = 0;
    var trace = new List<string>();
    while (remaining > 0)
    {
        long sent = Math.Min(cwnd, remaining);
        long overflow = Math.Max(0, sent - bdp - bufferSegs); // queue full: tail drop
        long random = 0;
        for (long i = 0; i < sent; i++) if (Rng() % LossScale < lossPer10k) random++;
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
            if (sent - lost < MinForFastRetransmit) { cwnd = 1; roundMs += Math.Max(MinRtoMs, RtoRtts * rttMs); } // too few dup ACKs: timeout
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
    var r = Transfer(FileBytes, LinkMbps, RttMs, BufferSegments, loss, Seed); // buffer = 1 BDP
    Console.WriteLine($"{name}: BDP={r.bdp} segments, file={r.total} segments");
    Console.WriteLine($"  cwnd per round: {string.Join(" ", r.trace.GetRange(0, Math.Min(14, r.rounds)))}{(r.rounds > 14 ? " ..." : "")}");
    Console.WriteLine($"  rounds={r.rounds} time={r.timeMs} ms retransmits={r.retransmits}");
}
Console.WriteLine($"ideal time at line rate: {(5000000 * 8) / 100000} ms"); // 100 Mbit/s = 100000 bits per ms
