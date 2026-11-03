# A miniature of Maglev hashing and connection tracking from Google's Maglev paper (NSDI 2016), in Python
# (a teaching model, not Google's code): each backend gets a permutation of the lookup table slots, the backends take turns
# claiming their next free preferred slot, a packet's hash picks a slot, and a per-machine connection table remembers the
# choice so that a connection survives changes to the backend set. Everything is deterministic.


def fnv(text):
    h = 0x811C9DC5
    for ch in text:
        h = ((h ^ ord(ch)) * 0x01000193) & 0xFFFFFFFF
    return h


def populate(params, size):  # params: (offset, skip) for each backend; returns the lookup table (backend index per slot)
    nxt = [0] * len(params)
    entry = [-1] * size

    def pref(i, j):  # permutation[i][j] = (offset + j * skip) mod M
        return (params[i][0] + j * params[i][1]) % size

    filled = 0
    while True:
        for i in range(len(params)):
            c = pref(i, nxt[i])
            while entry[c] >= 0:
                nxt[i] += 1
                c = pref(i, nxt[i])
            entry[c] = i
            nxt[i] += 1
            filled += 1
            if filled == size:
                return entry


def params_for(names, size):  # offset and skip come from two hash functions of the name
    return [(fnv(f"a{n}") % size, fnv(f"b{n}") % (size - 1) + 1) for n in names]


print("--- the paper's small example: 3 backends, 7 slots, (offset, skip) = (3,4) (0,2) (3,1)")
small = [(3, 4), (0, 2), (3, 1)]
names = ["B0", "B1", "B2"]
before = populate(small, 7)
kept = [0, 2]  # the backends left after B1 is removed
after = [kept[i] for i in populate([small[0], small[2]], 7)]
print("lookup table with B0, B1, B2: " + " ".join(names[i] for i in before))
print("lookup table without B1:      " + " ".join(names[i] for i in after))
moved = sum(1 for k in range(7) if before[k] != 1 and after[k] != before[k])
print(f"slots that held B1: {before.count(1)}; other slots that changed: {moved}")

print("--- 100 backends and a table of 65537 slots")
M = 65537
backends = [f"backend-{i}" for i in range(100)]
table = populate(params_for(backends, M), M)
counts = [table.count(i) for i in range(len(backends))]
print(f"slots per backend: min {min(counts)}, max {max(counts)}")
reduced = [b for i, b in enumerate(backends) if i != 7]
table2 = populate(params_for(reduced, M), M)


def name1(k):
    return backends[table[k]]


def name2(k):
    return reduced[table2[k]]


changed = sum(1 for k in range(M) if name1(k) != name2(k))
on_removed = table.count(7)
print(f"removing backend-7: {on_removed} slots held it, {changed} slots changed, {changed - on_removed} of them were not backend-7's")

print("--- 1000 connections when backend-7 is removed")
flows = [f"flow-{i}" for i in range(1000)]


def slot(f):
    return fnv(f) % M


tracked = {f: name1(slot(f)) for f in flows}  # the connection table of the Maglev machine that saw the first packets
on_gone = sum(1 for f in flows if tracked[f] == "backend-7")
without_table = sum(1 for f in flows if name1(slot(f)) != name2(slot(f)))
with_table = sum(1 for f in flows if tracked[f] == "backend-7" and name2(slot(f)) != tracked[f])
print(f"connections on backend-7: {on_gone}")
print(f"same machine, with its connection table: {with_table} connections change backend (only the ones that had to)")
print(f"a different Maglev machine after an ECMP change, empty table: {without_table} connections change backend")
