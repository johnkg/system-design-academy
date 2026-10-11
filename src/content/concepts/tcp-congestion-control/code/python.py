# A round-by-round model of TCP Reno (slow start + AIMD) on a fixed-capacity link.
# One loop iteration = one round trip: the sender puts cwnd segments in flight.
# All integer arithmetic, a seeded Park-Miller generator, no clock.
MSS = 1460
INITIAL_WINDOW = 10


def make_rng(seed):
    state = [seed]

    def next_value():
        state[0] = (state[0] * 48271) % 2147483647
        return state[0]
    return next_value


def transfer(file_bytes, mbps, rtt_ms, buffer_segs, loss_per_10k, seed):
    bdp = (mbps * 125 * rtt_ms) // MSS  # bytes per RTT / MSS = segments needed in flight to fill the link
    total = -(-file_bytes // MSS)
    rng = make_rng(seed)
    cwnd, ssthresh = INITIAL_WINDOW, 1000000000
    remaining, delivered, time_ms, retransmits = total, 0, 0, 0
    trace = []
    while remaining > 0:
        sent = min(cwnd, remaining)
        overflow = max(0, sent - bdp - buffer_segs)  # queue full: tail drop
        random = 0
        for _ in range(sent):
            if rng() % 10000 < loss_per_10k:
                random += 1
        lost = min(sent, overflow + random)
        # Invariant: more than BDP + buffer in flight cannot fit, so a loss event must follow.
        if sent > bdp + buffer_segs and lost == 0:
            raise SystemExit("window above BDP+buffer without a loss")
        queue = min(max(sent - bdp, 0), buffer_segs)
        round_ms = rtt_ms + (queue * rtt_ms) // bdp  # a standing queue inflates the RTT
        trace.append(str(cwnd) + ("*" if lost > 0 else ""))
        remaining -= sent - lost  # lost segments stay in "remaining" and are sent again
        delivered += sent - lost
        retransmits += lost
        if lost > 0:
            ssthresh = max(2, cwnd // 2)
            if sent - lost < 4:  # too few dup ACKs: timeout
                cwnd = 1
                round_ms += max(200, 3 * rtt_ms)
            else:  # fast retransmit + fast recovery
                cwnd = ssthresh
        elif cwnd < ssthresh:
            cwnd = min(cwnd * 2, ssthresh)  # slow start: double per RTT
        else:
            cwnd += 1  # congestion avoidance: +1 per RTT
        time_ms += round_ms
    if delivered != total:
        raise SystemExit("transfer incomplete")
    return bdp, total, len(trace), time_ms, retransmits, trace


for name, loss in [("clean link", 0), ("0.1% random loss", 10), ("1% random loss", 100)]:
    bdp, total, rounds, time_ms, retransmits, trace = transfer(5000000, 100, 80, 684, loss, 7)  # buffer = 1 BDP
    print(f"{name}: BDP={bdp} segments, file={total} segments")
    print(f"  cwnd per round: {' '.join(trace[:14])}{' ...' if rounds > 14 else ''}")
    print(f"  rounds={rounds} time={time_ms} ms retransmits={retransmits}")
print(f"ideal time at line rate: {(5000000 * 8) // 100000} ms")  # 100 Mbit/s = 100000 bits per ms
