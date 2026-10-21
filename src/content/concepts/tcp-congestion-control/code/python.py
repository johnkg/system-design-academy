# A round-by-round model of TCP Reno (slow start + AIMD) on a fixed-capacity link.
# One loop iteration = one round trip: the sender puts cwnd segments in flight.
# All integer arithmetic, a seeded Park-Miller generator, no clock.
MSS = 1460
INITIAL_WINDOW = 10
BYTES_PER_MS_PER_MBPS = 125  # 1 Mbit/s carries 125 bytes per millisecond
INITIAL_SSTHRESH = 1000000000  # effectively unlimited: slow start until the first loss
LOSS_SCALE = 10000  # loss rates are per 10,000 segments
MIN_FOR_FAST_RETRANSMIT = 4  # fewer segments than this cannot produce 3 duplicate ACKs
MIN_RTO_MS = 200
RTO_RTTS = 3  # a timeout costs max(MIN_RTO_MS, RTO_RTTS * RTT)
FILE_BYTES = 5000000  # demo: 5 MB over 100 Mbit/s with 80 ms RTT, buffer = 1 BDP
LINK_MBPS = 100
RTT_MS = 80
BUFFER_SEGMENTS = 684
SEED = 7


def make_rng(seed):
    state = [seed]

    def next_value():
        state[0] = (state[0] * 48271) % 2147483647
        return state[0]
    return next_value


def transfer(file_bytes, mbps, rtt_ms, buffer_segs, loss_per_10k, seed):
    bdp = (mbps * BYTES_PER_MS_PER_MBPS * rtt_ms) // MSS  # bytes per RTT / MSS = segments needed in flight to fill the link
    total = -(-file_bytes // MSS)
    rng = make_rng(seed)
    cwnd, ssthresh = INITIAL_WINDOW, INITIAL_SSTHRESH
    remaining, delivered, time_ms, retransmits = total, 0, 0, 0
    trace = []
    while remaining > 0:
        sent = min(cwnd, remaining)
        overflow = max(0, sent - bdp - buffer_segs)  # queue full: tail drop
        random = 0
        for _ in range(sent):
            if rng() % LOSS_SCALE < loss_per_10k:
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
            if sent - lost < MIN_FOR_FAST_RETRANSMIT:  # too few dup ACKs: timeout
                cwnd = 1
                round_ms += max(MIN_RTO_MS, RTO_RTTS * rtt_ms)
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
    bdp, total, rounds, time_ms, retransmits, trace = transfer(FILE_BYTES, LINK_MBPS, RTT_MS, BUFFER_SEGMENTS, loss, SEED)  # buffer = 1 BDP
    print(f"{name}: BDP={bdp} segments, file={total} segments")
    print(f"  cwnd per round: {' '.join(trace[:14])}{' ...' if rounds > 14 else ''}")
    print(f"  rounds={rounds} time={time_ms} ms retransmits={retransmits}")
print(f"ideal time at line rate: {(5000000 * 8) // 100000} ms")  # 100 Mbit/s = 100000 bits per ms
