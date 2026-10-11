# Maglev-style consistent hashing for a load balancer, in Python:
# every balancer builds the same lookup table from the backend names, so any of them sends a flow to the same backend,
# and when a backend leaves only the flows that were on it have to move. A connection-tracking table then pins live flows.
import sys

M = 997  # table size, a prime number (Maglev uses 65,537 or more)
MASK = 0xFFFFFFFF


def hash_name(s, seed):  # FNV-1a with a seed, kept to 32 bits
    h = (seed ^ 2166136261) & MASK
    for ch in s:
        h = ((h ^ ord(ch)) * 16777619) & MASK
    return h


def flow_hash(i):  # stands in for a hash of the 5-tuple (source and destination address and port, protocol)
    h = ((i + 1) * 2654435761) & MASK
    h = (h ^ (h >> 15)) & MASK
    h = (h * 2246822519) & MASK
    return (h ^ (h >> 13)) & MASK


def build_table(names):
    """Each backend has its own permutation of the table slots. Backends take turns claiming their next free slot."""
    offset = [hash_name(n, 1) % M for n in names]
    skip = [hash_name(n, 2) % (M - 1) + 1 for n in names]
    nxt = [0] * len(names)
    table = [-1] * M
    filled = 0
    while filled < M:
        for b in range(len(names)):
            if filled >= M:
                break
            slot = (offset[b] + nxt[b] * skip[b]) % M
            while table[slot] >= 0:
                nxt[b] += 1
                slot = (offset[b] + nxt[b] * skip[b]) % M
            table[slot] = b
            nxt[b] += 1
            filled += 1
    return [names[b] for b in table]


def pct(part, whole):
    t = part * 1000 // whole
    return f"{t // 10}.{t % 10}%"


FLOWS = 20000
names = ["b0", "b1", "b2", "b3", "b4"]
table = build_table(names)
share = {n: 0 for n in names}
for i in range(FLOWS):
    share[table[flow_hash(i) % M]] += 1
print("flows per backend: " + " ".join(f"{n}={share[n]}" for n in names))

# Remove b2: how many flows that were NOT on b2 get moved, with a modulo hash and with the Maglev table?
smaller = [n for n in names if n != "b2"]
table2 = build_table(smaller)
on_b2 = modulo_moved = maglev_moved = 0
for i in range(FLOWS):
    h = flow_hash(i)
    before = table[h % M]
    if before == "b2":
        on_b2 += 1
        continue
    if names[h % len(names)] != smaller[h % len(smaller)]:
        modulo_moved += 1
    if before != table2[h % M]:
        maglev_moved += 1
others = FLOWS - on_b2
print(f"b2 removed, flows on b2 (must move): {on_b2}")
print(f"other flows moved, modulo hash: {modulo_moved} of {others} ({pct(modulo_moved, others)})")
print(f"other flows moved, Maglev table: {maglev_moved} of {others} ({pct(maglev_moved, others)})")

# Connection tracking: a new flow is looked up in the table once, then remembered, so adding b5 later never breaks it.
tracked = {}


def route(i, tbl):
    if i not in tracked:
        tracked[i] = tbl[flow_hash(i) % M]
    return tracked[i]


for i in range(FLOWS):
    route(i, table)
table3 = build_table(names + ["b5"])
broken_tracked = broken_untracked = 0
for i in range(FLOWS):
    if route(i, table3) != table[flow_hash(i) % M]:
        broken_tracked += 1
    if table3[flow_hash(i) % M] != table[flow_hash(i) % M]:
        broken_untracked += 1
print(f"b5 added: broken flows without tracking {broken_untracked} ({pct(broken_untracked, FLOWS)}), with tracking {broken_tracked}")

counts = list(share.values())
ok = (max(counts) - min(counts) < FLOWS / len(names) / 10 and maglev_moved * 5 < others
      and modulo_moved * 2 > others and broken_tracked == 0)
print(f"checks pass: {'true' if ok else 'false'}")
if not ok:
    sys.exit(1)
