# Merkle tree anti-entropy: find and repair the key ranges where two replicas differ.
import hashlib
import sys

N_KEYS, LEAVES = 4096, 64
PER_LEAF = N_KEYS // LEAVES  # 64 keys per leaf range


def sha(data):
    return hashlib.sha256(data).digest()


def build_tree(store):
    # Leaf i hashes the sorted "key=value" lines of its key range; parents hash their two children.
    level = []
    for i in range(LEAVES):
        text = ""
        for k in range(i * PER_LEAF, (i + 1) * PER_LEAF):
            if k in store:
                text += f"{k}={store[k]}\n"
        level.append(sha(text.encode()))
    levels = [level]
    while len(level) > 1:
        level = [sha(level[i] + level[i + 1]) for i in range(0, len(level), 2)]
        levels.insert(0, level)
    return levels  # levels[0] = [root], levels[-1] = leaves


def diff(a, b, depth, idx, stats, out):
    stats["comparisons"] += 1  # one hash exchanged and compared
    if a[depth][idx] == b[depth][idx]:
        return
    if depth == len(a) - 1:
        out.append(idx)
        return
    diff(a, b, depth + 1, 2 * idx, stats, out)
    diff(a, b, depth + 1, 2 * idx + 1, stats, out)


# Replica A is the source of truth; B has drifted.
a = {k: f"v{(k * 7) % 1000}" for k in range(N_KEYS)}
b = dict(a)

seed = 42  # MINSTD generator


def rand(n):
    global seed
    seed = (seed * 48271) % 2147483647
    return seed % n


for _ in range(4):
    b[rand(N_KEYS)] = "stale"  # missed writes
b.pop(rand(N_KEYS), None)  # lost write

ta, tb = build_tree(a), build_tree(b)
print(f"roots equal before: {str(ta[0][0] == tb[0][0]).lower()}")
stats, ranges = {"comparisons": 0}, []
diff(ta, tb, 0, 0, stats, ranges)
print(f"differing ranges: {len(ranges)} -> [{', '.join(map(str, ranges))}]")
print(f"hash comparisons: {stats['comparisons']} ({stats['comparisons'] * 32} bytes), keys: {N_KEYS}, flat list: {LEAVES} hashes")

sent = 0
for i in ranges:
    for k in range(i * PER_LEAF, (i + 1) * PER_LEAF):
        if k in a:
            b[k] = a[k]
        else:
            b.pop(k, None)
        sent += 1
print(f"keys transferred: {sent} of {N_KEYS}")
tb2 = build_tree(b)
print(f"roots equal after: {str(ta[0][0] == tb2[0][0]).lower()}, root {ta[0][0].hex()[:8]}")

if ta[0][0] != tb2[0][0]:
    sys.exit(1)
if stats["comparisons"] * 20 >= N_KEYS:
    sys.exit(1)
if sent > len(ranges) * PER_LEAF:
    sys.exit(1)
