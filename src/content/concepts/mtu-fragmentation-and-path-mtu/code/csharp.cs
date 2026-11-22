// A toy hop-by-hop model of MTU, fragmentation and Path MTU Discovery for one TCP transfer over IPv4.
// Assumptions: IP header 20 bytes, TCP header 20 bytes (no options), so packet size = MSS + 40. The path is a list of link MTUs
// and a tunnel is modelled as a link whose MTU is 1500 minus its overhead (here 100 bytes, a made-up round number; real tunnels
// add roughly 20 to 100 bytes depending on the protocol, e.g. GRE 24, VXLAN 50, WireGuard 60 over IPv4). TCP typically sets the Don't Fragment (DF) bit.
// A router that drops a DF packet typically sends ICMP "fragmentation needed" carrying the next hop's MTU, if ICMP is not filtered.
// Fragments carry data in multiples of 8 bytes. Losing any one fragment loses the whole packet. Loss is given per 10,000 fragments.
using System;
using System.Collections.Generic;
using System.Linq;

const int Hdr = 40, Ip = 20;

int CeilDiv(int a, int b) => (a + b - 1) / b;

// Walk the first full-size packet down the path and say what each hop does with it.
List<string> Trace(int[] path, int size, bool df)
{
    var lines = new List<string>();
    for (int i = 0; i < path.Length; i++)
    {
        int mtu = path[i];
        if (size <= mtu) lines.Add($"hop {i + 1} MTU {mtu}: {size} bytes pass");
        else if (df) { lines.Add($"hop {i + 1} MTU {mtu}: {size} bytes with DF set, dropped"); break; }
        else
        {
            int per = (mtu - Ip) / 8 * 8;
            lines.Add($"hop {i + 1} MTU {mtu}: fragmented into {CeilDiv(size - Ip, per)} pieces of at most {per} data bytes");
            size = per + Ip; // later hops see the largest fragment; reassembly happens only at the destination
        }
    }
    return lines;
}

string Transfer(int[] path, int mss0, int bytes, bool df, bool icmp, bool clamp, int lossPer10k)
{
    int pmtu = path.Min();
    int mss = clamp ? Math.Min(mss0, pmtu - Hdr) : mss0; // an endpoint rewrites the MSS in the SYN
    int size = Math.Min(mss, bytes) + Hdr;
    int packets, frags = 1, wasted = 0;
    string result;
    if (size <= pmtu) { packets = CeilDiv(bytes, mss); result = "complete"; }
    else if (!df)
    {
        frags = CeilDiv(mss + Ip, (pmtu - Ip) / 8 * 8);
        packets = CeilDiv(bytes, mss); result = "complete (fragmented)";
    }
    else if (icmp) { mss = pmtu - Hdr; packets = CeilDiv(bytes, mss); wasted = 1; result = "complete after path MTU discovery"; }
    else { packets = 0; result = "stalled, 0 bytes delivered"; }
    int survive = 10000;
    for (int k = 0; k < frags; k++) survive = survive * (10000 - lossPer10k) / 10000;
    string tail = packets == 0 ? "no packets get through" : survive + " of 10000 packets survive";
    return $"path MTU={pmtu} MSS={mss} packets sent={packets + wasted} wire fragments={packets * frags} extra round trips={wasted} result={result}; {tail}";
}

int[] clean = { 1500, 1500, 1500 }, tunnel = { 1500, 1400, 1500 };
const int Bytes = 100000, Loss = 100;
Console.WriteLine("first full packet, DF set:   " + string.Join(" | ", Trace(tunnel, 1500, true)));
Console.WriteLine("first full packet, DF clear: " + string.Join(" | ", Trace(tunnel, 1500, false)));
Console.WriteLine("no tunnel:                       " + Transfer(clean, 1460, Bytes, true, true, false, Loss));
Console.WriteLine("tunnel, DF, ICMP allowed:        " + Transfer(tunnel, 1460, Bytes, true, true, false, Loss));
Console.WriteLine("tunnel, DF, ICMP blocked:        " + Transfer(tunnel, 1460, Bytes, true, false, false, Loss));
Console.WriteLine("tunnel, DF, ICMP blocked, 1 KB:  " + Transfer(tunnel, 1460, 1000, true, false, false, Loss));
Console.WriteLine("tunnel, DF, ICMP blocked, clamp: " + Transfer(tunnel, 1460, Bytes, true, false, true, Loss));
Console.WriteLine("tunnel, DF cleared:              " + Transfer(tunnel, 1460, Bytes, false, false, false, Loss));
