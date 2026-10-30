# A miniature of the ideas in Cloudflare's Unimog, in Python (a teaching model, not Cloudflare's code or data):
# every connection's 4-tuple is hashed into a bucket of a forwarding table, each bucket holds a current and a previous
# server, a redirector sends a packet on to the previous server when the current one has no socket for it, a drain keeps
# old connections alive, and a control loop moves buckets from busy servers to idle ones.
# Everything is deterministic and uses whole numbers only, so every run prints the same thing.
import sys

NAMES = ["A", "B", "C"]
BUCKETS = 64  # always a power of two, so the low 6 bits of the hash pick the bucket (Unimog uses far more than this)
MASK = BUCKETS - 1
NONE = -1
CAPACITY = [100, 200, 200]  # how much work each server can do: a different hardware generation each (made-up units)
BACKGROUND = [0, 150, 0]  # per mille of load from work that has nothing to do with connections (made up)
CONNECTIONS = 30
SPREAD = 20  # the control loop stops when the two loads are this close, per mille
MAX_ROUNDS = 12


# 32-bit FNV-1a over the text of a connection's 4-tuple, standing in for Unimog's hash function.
def fnv(text):
    h = 0x811C9DC5
    for b in text.encode():
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h


def bucket_of(conn):
    return fnv(f"10.0.0.{conn}:5000>203.0.113.7:443") & MASK


def new_table():  # each bucket: [first slot, second slot]
    return [[i % len(NAMES), NONE] for i in range(BUCKETS)]


# What the redirector does with a packet. A SYN starts a connection and always stays on the first server.
# Any other packet stays there only if that server has a socket for it, and otherwise goes on to the second server.
def deliver(table, sockets, conn, syn):
    first, second = table[bucket_of(conn)]
    if syn:
        return first, "new connection on first server"
    if conn in sockets[first]:
        return first, "first hop"
    if second != NONE and conn in sockets[second]:
        return second, "second hop"
    return NONE, "reset (connection broken)"


def tally(table, sockets, conns):
    broken = hops = 0
    for c in conns:
        server, how = deliver(table, sockets, c, False)
        broken += server == NONE
        hops += how == "second hop"
    return broken, hops


def buckets_per_server(table):
    return [sum(1 for b in table if b[0] == s) for s in range(len(NAMES))]


def loads(table):  # per mille of capacity in use
    return [n * 1000 // CAPACITY[s] + BACKGROUND[s] for s, n in enumerate(buckets_per_server(table))]


# Drain: stop new connections to a server but keep serving the old ones. With keep_old=False the table has only one
# slot per bucket, so the old server is forgotten.
def drain(table, victim, others, keep_old, stamp, touched):
    n = 0
    for i, b in enumerate(table):
        if b[0] == victim:
            counts = buckets_per_server(table)
            b[0] = min(others, key=lambda s: (counts[s], s))
            b[1] = victim if keep_old else NONE
            touched[i] = stamp
            n += 1
    return n


# One round of the control loop: servers above the average load give away buckets in proportion to how far above they are,
# and the least loaded server takes them. The least recently changed buckets move first. The new owner becomes the first slot
# and the old owner the second slot, so connections already open on the old owner keep working.
def rebalance(table, active, stamp, touched):
    ld = loads(table)
    avg = sum(ld[s] for s in active) // len(active)
    moved = 0
    for s in active:
        if ld[s] <= avg:
            continue
        mine = [i for i, b in enumerate(table) if b[0] == s]
        give = max(1, len(mine) * (ld[s] - avg) // ld[s])
        mine.sort(key=lambda i: (touched[i], i))
        for i in mine[:give]:
            to = min((t for t in active if t != s), key=lambda t: (loads(table)[t], t))
            table[i] = [to, s]
            touched[i] = stamp
            moved += 1
    return moved


def show(title, table):
    ld = loads(table)
    print(f"{title}: buckets " + " ".join(f"{NAMES[s]}={n}" for s, n in enumerate(buckets_per_server(table)))
          + " | load per mille " + " ".join(f"{NAMES[s]}={ld[s]}" for s in range(len(NAMES))))


conns = list(range(CONNECTIONS))
table = new_table()
touched = [0] * BUCKETS
sockets = [set() for _ in NAMES]
for c in conns:  # each connection is opened on the first server of its bucket
    sockets[table[bucket_of(c)][0]].add(c)
print(f"{CONNECTIONS} connections open: " + " ".join(f"{NAMES[s]}={len(sockets[s])}" for s in range(len(NAMES))))
show("start", table)

# 1. Drain server A, first with a one-slot table, then with two slots.
one_slot = [b[:] for b in table]
drain(one_slot, 0, [1, 2], False, 1, [0] * BUCKETS)
lost_one_slot = tally(one_slot, sockets, conns)[0]
print(f"drain A, one slot per bucket: {lost_one_slot} of {len(sockets[0])} connections on A broken")
n = drain(table, 0, [1, 2], True, 1, touched)
broken, hops = tally(table, sockets, conns)
lost_two_slots = broken
print(f"drain A, two slots per bucket: {n} buckets changed, {broken} broken, {hops} connections now use a second hop")
fresh = [deliver(table, sockets, 100 + k, True)[0] for k in range(12)]
print("12 new connections go to: " + " ".join(NAMES[s] for s in fresh))

# 2. The connections on A end. A is no longer needed as a second server.
sockets[0].clear()
for b in table:
    if b[1] == 0:
        b[1] = NONE
live = [c for c in conns if any(c in s for s in sockets)]
print(f"A's connections ended, {len(live)} remain, second slots cleared")

# 3. The control loop works on the servers still in service, until the two loads are within 20 per mille of each other.
show("before the loop", table)
rnd = 0
lost_in_loop = 0
while True:
    ld = loads(table)
    if abs(ld[1] - ld[2]) <= SPREAD or rnd == MAX_ROUNDS:
        break
    rnd += 1
    moved = rebalance(table, [1, 2], rnd + 1, touched)
    broken, hops = tally(table, sockets, live)
    ld = loads(table)
    lost_in_loop += broken
    print(f"round {rnd}: moved {moved} buckets, load B={ld[1]} C={ld[2]}, {broken} broken, {hops} on a second hop")
show("after the loop", table)

# 4. The limit: change the same bucket twice in a row and the server from before the first change is forgotten.
# A comes back from maintenance and takes a bucket whose old connections are still open on B.
target = next(i for i, b in enumerate(table) if b[1] != NONE and any(c in sockets[b[1]] for c in live if bucket_of(c) == i))
first, second = table[target]
in_bucket = [c for c in live if bucket_of(c) == target]
table[target] = [0, first]
broken, hops = tally(table, sockets, in_bucket)
print(f"bucket {target} changed again before {NAMES[second]}'s connections ended: {broken} of {len(in_bucket)} broken")
ok = lost_one_slot > 0 and lost_two_slots == 0 and lost_in_loop == 0 and broken > 0
print(f"checks {'passed' if ok else 'FAILED'}")
sys.exit(0 if ok else 1)
