# A toy hop-by-hop model of MTU, fragmentation and Path MTU Discovery for one TCP transfer over IPv4.
# Assumptions: IP header 20 bytes, TCP header 20 bytes (no options), so packet size = MSS + 40. The path is a list of link MTUs
# and a tunnel is modelled as a link whose MTU is 1500 minus its overhead (here 100 bytes, a made-up round number; real tunnels
# typically add somewhere between 50 and 100 bytes depending on the protocol). TCP typically sets the Don't Fragment (DF) bit.
# A router that drops a DF packet typically sends ICMP "fragmentation needed" carrying the next hop's MTU, if ICMP is not filtered.
# Fragments carry data in multiples of 8 bytes. Losing any one fragment loses the whole packet. Loss is given per 10,000 fragments.

HDR, IP = 40, 20


def ceil_div(a, b):
    return -(-a // b)


# Walk the first full-size packet down the path and say what each hop does with it.
def trace(path, size, df):
    lines = []
    for i, mtu in enumerate(path):
        if size <= mtu:
            lines.append(f"hop {i + 1} MTU {mtu}: {size} bytes pass")
        elif df:
            lines.append(f"hop {i + 1} MTU {mtu}: {size} bytes with DF set, dropped")
            break
        else:
            per = ((mtu - IP) // 8) * 8
            lines.append(f"hop {i + 1} MTU {mtu}: fragmented into {ceil_div(size - IP, per)} pieces of at most {per} data bytes")
            size = per + IP  # later hops see the largest fragment; reassembly happens only at the destination
    return lines


def transfer(path, mss0, nbytes, df, icmp, clamp, loss_per_10k):
    pmtu = min(path)
    mss = min(mss0, pmtu - HDR) if clamp else mss0  # an endpoint rewrites the MSS in the SYN
    size = min(mss, nbytes) + HDR
    frags, wasted = 1, 0
    if size <= pmtu:
        packets = ceil_div(nbytes, mss)
        result = "complete"
    elif not df:
        frags = ceil_div(mss + IP, ((pmtu - IP) // 8) * 8)
        packets = ceil_div(nbytes, mss)
        result = "complete (fragmented)"
    elif icmp:
        mss = pmtu - HDR
        packets = ceil_div(nbytes, mss)
        wasted = 1
        result = "complete after path MTU discovery"
    else:
        packets = 0
        result = "stalled, 0 bytes delivered"
    survive = 10000
    for _ in range(frags):
        survive = (survive * (10000 - loss_per_10k)) // 10000
    tail = "no packets get through" if packets == 0 else f"{survive} of 10000 packets survive"
    return f"path MTU={pmtu} MSS={mss} packets sent={packets + wasted} wire fragments={packets * frags} extra round trips={wasted} result={result}; {tail}"


CLEAN, TUNNEL, BYTES, LOSS = [1500, 1500, 1500], [1500, 1400, 1500], 100000, 100
print("first full packet, DF set:   " + " | ".join(trace(TUNNEL, 1500, True)))
print("first full packet, DF clear: " + " | ".join(trace(TUNNEL, 1500, False)))
print("no tunnel:                       " + transfer(CLEAN, 1460, BYTES, True, True, False, LOSS))
print("tunnel, DF, ICMP allowed:        " + transfer(TUNNEL, 1460, BYTES, True, True, False, LOSS))
print("tunnel, DF, ICMP blocked:        " + transfer(TUNNEL, 1460, BYTES, True, False, False, LOSS))
print("tunnel, DF, ICMP blocked, 1 KB:  " + transfer(TUNNEL, 1460, 1000, True, False, False, LOSS))
print("tunnel, DF, ICMP blocked, clamp: " + transfer(TUNNEL, 1460, BYTES, True, False, True, LOSS))
print("tunnel, DF cleared:              " + transfer(TUNNEL, 1460, BYTES, False, False, False, LOSS))
