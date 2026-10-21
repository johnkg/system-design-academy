# Simulate losing region A while region B holds a standby copy. Integer milliseconds and a seeded
# generator make the run reproducible. It measures RTO (downtime), RPO (acknowledged writes lost
# to replication lag) and the split-brain writes the old primary accepts when it comes back.
import math
import sys

FAIL_AT, CLIENTS, SYNC_RTT, BACK_AFTER_PROMOTE = 25000, 100, 80, 15000
SEED = 42
HORIZON_SLACK_MS = 1000  # keep simulating this long after the last client recovers
WRITE_GAP_MIN_MS = 50  # writes arrive every 50..149 ms (about 10 per second)
WRITE_GAP_SPREAD_MS = 100
LAG_MIN_PCT = 50  # each write's replication lag is 50..149% of lagMs
LAG_SPREAD_PCT = 100


# Park-Miller (MINSTD) generator
def make_rng(seed):
    state = [seed]

    def rng(n):
        state[0] = (state[0] * 48271) % 2147483647
        return state[0] % n
    return rng


class Fence:
    """A fencing token authority: every promotion bumps the epoch, and storage rejects older epochs."""

    def __init__(self, promote_at):
        self.promote_at = promote_at

    def epoch_at(self, t):
        return 2 if t >= self.promote_at else 1

    def accepts(self, writer_epoch, t):
        return writer_epoch >= self.epoch_at(t)


def simulate(sync, lag_ms, ttl_ms, interval_ms, threshold, promote_ms, fencing):
    rng = make_rng(SEED)
    # 1. Failure detection: health checks run every interval; N consecutive failures declare A dead.
    first_bad_check = math.ceil(FAIL_AT / interval_ms) * interval_ms
    detect_at = first_bad_check + (threshold - 1) * interval_ms
    # 2. Promotion: the standby is started or scaled up and made writable (epoch 1 -> 2), then DNS flips.
    promote_at = detect_at + promote_ms
    fence = Fence(promote_at)
    back_at = promote_at + BACK_AFTER_PROMOTE
    # 3. Each client cached the old DNS answer at some random moment, so it keeps using A until its TTL ends.
    recover_at = [promote_at + rng(ttl_ms) for _ in range(CLIENTS)]
    horizon = max(recover_at) + HORIZON_SLACK_MS
    # 4. A seeded write stream (about 10 per second), replicated to B in order after a random lag.
    t = applied = acked = lost = failed = fenced = diverged = 0
    oldest_lost = -1
    while True:
        t += WRITE_GAP_MIN_MS + rng(WRITE_GAP_SPREAD_MS)
        if t >= horizon:
            break
        client = rng(CLIENTS)
        lag = (lag_ms * (LAG_MIN_PCT + rng(LAG_SPREAD_PCT))) // 100
        if t < FAIL_AT:
            if sync and t + SYNC_RTT > FAIL_AT:
                failed += 1  # never acknowledged: the client retries
                continue
            acked += 1
            applied = max(applied, t + (SYNC_RTT if sync else lag))  # in-order apply on B
            if not sync and applied > FAIL_AT:
                lost += 1
                if oldest_lost < 0:
                    oldest_lost = t
        elif t < recover_at[client]:  # this client still resolves to A
            if t < back_at:
                failed += 1  # A is down
            elif not fencing or fence.accepts(1, t):
                diverged += 1  # A is back, still thinks it is primary
            else:
                fenced += 1  # the stale epoch is rejected
    srt = sorted(recover_at)
    return dict(detect_at=detect_at, promote_at=promote_at, back_at=back_at, acked=acked, lost=lost,
                rpo_ms=0 if oldest_lost < 0 else FAIL_AT - oldest_lost, rto_ms=srt[CLIENTS - 1] - FAIL_AT,
                p50_ms=srt[CLIENTS // 2] - FAIL_AT, failed=failed, fenced=fenced, diverged=diverged)


base = dict(sync=False, lag_ms=500, ttl_ms=60000, interval_ms=10000, threshold=3, promote_ms=45000, fencing=False)
scenarios = [
    ("async, warm standby, no fencing", base),
    ("async, warm standby, fencing", {**base, "fencing": True}),
    ("sync replication, fencing", {**base, "sync": True, "fencing": True}),
    ("fast config: hot standby, TTL 5s, 5s checks x2",
     {**base, "ttl_ms": 5000, "interval_ms": 5000, "threshold": 2, "promote_ms": 2000, "fencing": True}),
]
out = [(name, simulate(**p)) for name, p in scenarios]
for name, r in out:
    print(name)
    print(f"  detected at {r['detect_at']}ms, promoted at {r['promote_at']}ms, old region back at {r['back_at']}ms")
    print(f"  RTO all clients {r['rto_ms']}ms, half of clients {r['p50_ms']}ms")
    print(f"  RPO: {r['lost']} of {r['acked']} acked writes lost, window {r['rpo_ms']}ms")
    print(f"  writes rejected {r['failed']}, fenced {r['fenced']}, split-brain {r['diverged']}")

a, b, s, f = (o[1] for o in out)
fence = Fence(100)
if not (fence.accepts(1, 99) and not fence.accepts(1, 100) and fence.accepts(2, 100)):
    sys.exit(1)
ok = (a["diverged"] > 0 and b["diverged"] == 0 and b["fenced"] == a["diverged"] and a["lost"] == b["lost"]
      and a["lost"] > 0 and s["lost"] == 0 and s["rpo_ms"] == 0 and f["rto_ms"] < a["rto_ms"]
      and a["rto_ms"] >= a["promote_at"] - FAIL_AT)
print(f"invariants hold: {str(ok).lower()}")
if not ok:
    sys.exit(1)
