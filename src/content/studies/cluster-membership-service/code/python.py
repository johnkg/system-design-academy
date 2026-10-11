# SWIM-style membership in Python: random probes, indirect probes, a suspicion state, incarnation numbers,
# updates piggybacked on the probe messages, and a consistent-hash ring that reacts to the verdicts.
import sys

N, CRASH, SLOW, CRASH_AT, PAUSE_AT, PAUSE_FOR, ROUNDS = 12, 3, 7, 5, 20, 4, 40
RETRANSMIT, PIGGYBACK, LOSS = 8, 4, 5  # each update is sent 8 times, 4 per message, 5% of messages are lost
ALIVE, SUSPECT, DEAD = 0, 1, 2
MASK = 0xFFFFFFFF

seed = 7


def rand(n):
    global seed
    seed = (seed * 1664525 + 1013904223) & MASK
    return (seed >> 16) % n


def running(x, t):
    return not (x == CRASH and t >= CRASH_AT) and not (x == SLOW and PAUSE_AT <= t < PAUSE_AT + PAUSE_FOR)


class Node:
    def __init__(self, ident):
        self.id, self.inc, self.refute = ident, 0, False
        self.status, self.known, self.since = [ALIVE] * N, [0] * N, [0] * N
        self.buffer = []  # pending updates: dicts with who, status, inc, left


def run(suspect_for):
    global seed
    seed = 7
    nodes = [Node(i) for i in range(N)]
    ever_dead = set()
    learned_at = -1

    def queue(node, who, status, inc):
        node.buffer = [u for u in node.buffer if u["who"] != who]
        node.buffer.append({"who": who, "status": status, "inc": inc, "left": RETRANSMIT})

    def apply(node, u, t):
        if u["who"] == node.id:  # someone doubts me
            if u["status"] != ALIVE and u["inc"] >= node.inc:
                node.refute = True
            return
        w = u["who"]
        if u["status"] == ALIVE:
            fresh = u["inc"] > node.known[w]
        elif u["status"] == SUSPECT:
            fresh = node.status[w] != DEAD and (u["inc"] > node.known[w] or (u["inc"] == node.known[w] and node.status[w] == ALIVE))
        else:
            fresh = node.status[w] != DEAD and u["inc"] >= node.known[w]
        if not fresh:
            return
        node.status[w], node.known[w], node.since[w] = u["status"], u["inc"], t
        if u["status"] == DEAD and w != CRASH:
            ever_dead.add(w)
        queue(node, w, u["status"], u["inc"])

    def send(frm, to, t):  # one message with piggybacked updates; False if it was lost
        src = nodes[frm]
        src.buffer.sort(key=lambda u: (-u["left"], u["who"]))
        items = src.buffer[:PIGGYBACK]
        for u in items:
            u["left"] -= 1
        src.buffer = [u for u in src.buffer if u["left"] > 0]
        if rand(100) < LOSS:
            return False
        for u in items:
            apply(nodes[to], u, t)
        return True

    for t in range(ROUNDS):
        for node in nodes:
            if not running(node.id, t):
                continue
            if node.refute:  # refute with a higher incarnation
                node.refute = False
                node.inc += 1
                queue(node, node.id, ALIVE, node.inc)
            others = [n.id for n in nodes if n.id != node.id and node.status[n.id] != DEAD]
            target = others[rand(len(others))]
            ok = send(node.id, target, t) and running(target, t) and send(target, node.id, t)
            if not ok:  # indirect probes through two other nodes
                helpers = [x for x in others if x != target]
                for _ in range(2):
                    if not helpers:
                        break
                    m = helpers.pop(rand(len(helpers)))
                    if send(node.id, m, t) and running(m, t) and send(m, target, t) and running(target, t) and send(target, m, t) and send(m, node.id, t):
                        ok = True
            if not ok:
                apply(node, {"who": target, "status": SUSPECT, "inc": node.known[target]}, t)
            for j in range(N):
                if node.status[j] == SUSPECT and t - node.since[j] >= suspect_for:
                    apply(node, {"who": j, "status": DEAD, "inc": node.known[j]}, t)
        if learned_at < 0 and t >= CRASH_AT and all(n.id == CRASH or n.status[CRASH] == DEAD for n in nodes):
            learned_at = t - CRASH_AT
    return learned_at, sorted(ever_dead), nodes[SLOW].inc


def mix(x):
    x = ((x ^ (x >> 16)) * 0x45D9F3B) & MASK
    x = ((x ^ (x >> 16)) * 0x45D9F3B) & MASK
    return (x ^ (x >> 16)) & MASK


def owner(key, members):  # first token at or after the key's hash, going clockwise
    h = mix(key * 31 + 5)
    best, best_tok, first, first_tok = -1, 0, -1, 0
    for m in members:
        for v in range(8):
            tok = mix(m * 100 + v)
            if tok >= h and (best < 0 or tok < best_tok):
                best, best_tok = m, tok
            if first < 0 or tok < first_tok:
                first, first_tok = m, tok
    return best if best >= 0 else first


for suspect_for in (6, 2):
    learned, false_dead, inc_slow = run(suspect_for)
    print(f"suspicion {suspect_for}: crash known by every node {learned} rounds after it happened; healthy nodes declared dead: [{','.join(map(str, false_dead))}]; slow node incarnation {inc_slow}")
    if learned < 0:
        sys.exit(1)
    if suspect_for == 6 and (len(false_dead) != 0 or inc_slow < 1):
        sys.exit(1)  # the pause is shorter than the suspicion time, so it is refuted
    if suspect_for == 2 and SLOW not in false_dead:
        sys.exit(1)  # a too-short suspicion time causes a false positive

everyone = list(range(N))
keys = range(1000)
before = [owner(k, everyone) for k in keys]


def moved(gone):
    rest = [m for m in everyone if m != gone]
    return sum(1 for k in keys if owner(k, rest) != before[k])


def owned(x):
    return sum(1 for o in before if o == x)


print(f"ring: removing node {CRASH} moves {moved(CRASH)} of 1000 keys, exactly the {owned(CRASH)} it owned")
print(f"ring: a false alarm on node {SLOW} moves {moved(SLOW)} keys out and {moved(SLOW)} back")
if moved(CRASH) != owned(CRASH) or moved(SLOW) != owned(SLOW) or owned(CRASH) == 0:
    sys.exit(1)
