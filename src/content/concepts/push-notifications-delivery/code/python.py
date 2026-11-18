# 30 notifications are sent over one day through a platform push service to one phone that is offline for a while,
# and to a fleet of 1,000 device tokens, some of them stale. Minutes and integers only; the seed is fixed.
MINUTES_PER_DAY = 1440
NOTIFICATIONS = 30
OFFLINE_START = 300  # the phone loses its connection at 05:00
FLEET = 1000


def make_rng(seed):
    state = [seed]

    def nxt():
        state[0] = (state[0] * 48271) % 2147483647
        return state[0]

    return nxt


# One notification about every 48 minutes. About 4 in 10 are "score updates" (newer ones make older ones pointless).
def stream():
    nxt = make_rng(83)
    items = []
    for k in range(NOTIFICATIONS):
        t = k * 48 + (nxt() % 48)
        kind = "score" if nxt() % 10 < 4 else "message"
        jitter = nxt() % 16  # how long a normal-priority message waits for the device to be reachable, in minutes
        items.append({"t": t, "kind": kind, "jitter": jitter})
    return items


# ttl: minutes the platform holds an undelivered message. collapse: score updates share a collapse key.
# priority: 'high' wakes the device at once; 'normal' may wait for it. stale_pct: share of the fleet's tokens that are dead.
def run(offline_min, ttl, collapse, priority, stale_pct):
    reconnect = min(OFFLINE_START + offline_min, MINUTES_PER_DAY)
    delivered = expired = collapsed = delay_sum = 0
    pending = []
    for n in stream():
        if OFFLINE_START <= n["t"] < reconnect:
            pending.append(n)  # the platform holds it
            continue
        delivered += 1  # device reachable: delivered now
        delay_sum += n["jitter"] % 2 if priority == "high" else n["jitter"]
    last_score = max([-1] + [n["t"] for n in pending if n["kind"] == "score"]) if collapse else -1
    for n in pending:
        if collapse and n["kind"] == "score" and n["t"] != last_score:
            collapsed += 1  # replaced by a newer one with the same key
            continue
        if reconnect - n["t"] > ttl:
            expired += 1  # held longer than the TTL: dropped
            continue
        delivered += 1
        delay_sum += reconnect - n["t"]
    avg_delay = delay_sum // delivered
    # The fleet: every notification is sent to every token. A dead token gets an "invalid token" answer from the platform.
    stale = FLEET * stale_pct // 100
    sends = NOTIFICATIONS * FLEET
    wasted_keep = NOTIFICATIONS * stale  # never removed: the same dead tokens are tried for every notification
    wasted_prune = stale                 # removed after the first "invalid" answer
    print(f"offline {offline_min} min, TTL {ttl} min, collapse {'on' if collapse else 'off'}, {priority} priority, {stale_pct}% stale")
    print(f"  phone: delivered {delivered}, expired {expired}, collapsed {collapsed}; average delay {avg_delay} min; {len(pending)} held while offline")
    print(f"  fleet: {sends} sends, {stale} dead tokens; wasted sends {wasted_keep} without pruning, {wasted_prune} with pruning")
    if delivered + expired + collapsed != NOTIFICATIONS:
        raise Exception("every notification must be accounted for")


run(240, 120, False, "normal", 10)
run(240, 120, True, "normal", 10)
run(240, 480, True, "normal", 10)
run(240, 120, False, "high", 10)
run(600, 60, False, "normal", 25)
