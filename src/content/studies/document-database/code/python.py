# A replica set failing over, in Python: five nodes with a replicated log (the oplog),
# writes acknowledged either by the primary alone (w:1) or by a majority (w:majority), then the primary dies and an election runs.
# A voter only grants its vote to a candidate whose log is at least as long as its own.
import sys

NODES, MAJORITY = 5, 3
TRIALS, SEED_BASE = 8, 1000
MIN_CRASH, CRASH_SPREAD = 40, 20  # the primary dies after 40..59 writes
SLOW_NODE, SLOW_STEPS, STEPS = 4, 2, 3  # per tick a secondary copies 0..2 entries, the slow one 0..1
ELECTION_TIMEOUT = 150  # election timeouts are random in 0..149 ms
seed = 0


def next_int(n):
    global seed
    seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
    return (seed >> 8) % n


# A log is just its length here: every secondary holds a prefix of the primary's log.
def trial(n):
    global seed
    seed = SEED_BASE + n
    length = [0] * NODES                                 # node 0 is the primary
    crash_at = MIN_CRASH + next_int(CRASH_SPREAD)
    is_majority_write = [False]                          # write k (1-based) uses w:majority when true
    for _ in range(crash_at):
        length[0] += 1
        is_majority_write.append(next_int(2) == 1)
        for i in range(1, NODES):                        # node 4 sits on a slow link
            step = next_int(SLOW_STEPS if i == SLOW_NODE else STEPS)
            length[i] = min(length[0], length[i] + step)
    commit = sorted(length, reverse=True)[MAJORITY - 1]  # the longest prefix that a majority holds
    primary_len = length[0]

    # Election among the four survivors, in the order their random timeouts fire.
    order = sorted(((next_int(ELECTION_TIMEOUT), i) for i in (1, 2, 3, 4)))
    winner, denied = -1, 0
    for _, c in order:
        votes = sum(1 for v in (1, 2, 3, 4) if length[c] >= length[v])
        if votes >= MAJORITY:
            winner = c
            break
        denied += 1                                      # too stale to collect a majority
    keep = length[winner]                                # everything after this is rolled back
    lost_w1 = lost_majority = 0
    for k in range(keep + 1, primary_len + 1):
        if not is_majority_write[k]:
            lost_w1 += 1                                 # w:1 was acknowledged right away, so the client was told "ok"
        elif k <= commit:
            lost_majority += 1                           # acknowledged by a majority: must never happen
    return {"crash_at": crash_at, "commit": commit, "winner": winner, "keep": keep, "denied": denied,
            "rolled_back": primary_len - keep, "lost_w1": lost_w1, "lost_majority": lost_majority}


# A partition: a side can elect a primary only if it can reach a majority of the five nodes, otherwise it stays read-only.
def partition(reachable):
    can_elect = "true" if reachable >= MAJORITY else "false"
    return f"partition: {reachable} of {NODES} nodes reachable, can elect a primary: {can_elect}"


total = {"rolled_back": 0, "lost_w1": 0, "lost_majority": 0, "denied": 0}
for n in range(1, TRIALS + 1):
    r = trial(n)
    print(f"trial {n}: crash after {r['crash_at']} writes, committed {r['commit']}, node {r['winner']} wins with {r['keep']}, "
          f"stale candidates denied {r['denied']}, rolled back {r['rolled_back']}, lost w:1 acks {r['lost_w1']}, lost majority acks {r['lost_majority']}")
    for k in total:
        total[k] += r[k]
print(f"total: rolled back {total['rolled_back']}, lost w:1 acks {total['lost_w1']}, lost majority acks {total['lost_majority']}, denied {total['denied']}")
for side in (1, 2, 3, 4):
    print(partition(side))
if total["lost_majority"] != 0:
    sys.exit(1)
