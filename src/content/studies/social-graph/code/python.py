# A sharded friend graph in Python:
# sorted adjacency lists, mutual friends by merging two lists, friend-of-friend with a cap on hubs, and bidirectional search.
import sys
from bisect import bisect_left, insort

USERS, SHARDS, HUB_CAP = 500, 4, 100
INF = float('inf')
adj = [[] for _ in range(USERS)]  # each list stays sorted
stats = {'edges': 0, 'cross': 0}


def shard_of(u):  # the shard that owns user u's list
    return u % SHARDS


def is_friend(a, b):
    i = bisect_left(adj[a], b)
    return i < len(adj[a]) and adj[a][i] == b


def connect(a, b):  # a friendship is stored twice, once in each person's list, and these may be on two shards
    if a == b or is_friend(a, b):
        return
    insort(adj[a], b)
    insort(adj[b], a)
    stats['edges'] += 1
    if shard_of(a) != shard_of(b):
        stats['cross'] += 1


def mutual(a, b):  # walk two sorted lists together; the cost is the sum of their lengths at most
    x, y, common = adj[a], adj[b], []
    i = j = steps = 0
    while i < len(x) and j < len(y):
        steps += 1
        if x[i] == y[j]:
            common.append(x[i])
            i += 1
            j += 1
        elif x[i] < y[j]:
            i += 1
        else:
            j += 1
    return common, steps


def suggest(u, cap):  # count how many friends each stranger shares with u, skipping friends with more than `cap` friends
    count, touched, shards = {}, 0, set()
    for f in adj[u]:
        if len(adj[f]) > cap:  # a hub would add thousands of weak candidates
            continue
        shards.add(shard_of(f))
        for g in adj[f]:
            touched += 1
            if g != u and not is_friend(u, g):
                count[g] = count.get(g, 0) + 1
    ranked = sorted(count.items(), key=lambda p: (-p[1], p[0]))
    return ranked, touched, len(shards)


def bfs(a, b):  # plain breadth-first search
    dist, queue, scanned = {a: 0}, [a], 0
    while queue and b not in dist:
        nxt = []
        for u in queue:
            for v in adj[u]:
                scanned += 1
                if v not in dist:
                    dist[v] = dist[u] + 1
                    nxt.append(v)
        queue = nxt
    return dist.get(b), scanned


def bidirectional(a, b):  # search from both ends and meet in the middle
    if a == b:
        return 0, 0
    seen, front, scanned = [{a: 0}, {b: 0}], [[a], [b]], 0
    while front[0] and front[1]:
        s = 0 if len(front[0]) <= len(front[1]) else 1  # always grow the smaller side
        mine, other, nxt, best = seen[s], seen[1 - s], [], INF
        for u in front[s]:
            for v in adj[u]:
                scanned += 1
                if v in other:
                    best = min(best, mine[u] + 1 + other[v])
                if v not in mine:
                    mine[v] = mine[u] + 1
                    nxt.append(v)
        if best < INF:
            return best, scanned
        front[s] = nxt
    return -1, scanned


SEED, CELEBRITIES, CELEB_IN_10, FRIENDS_EACH, NEIGHBOR_SPAN = 7, 3, 3, 6, 25  # users 0..2 are celebrities that 3 in 10 friendships point to
USER_A, USER_B = 250, 262  # the pair the demo looks at
PAIRS, STRIDE_A, STRIDE_B, OFFSET_B = 200, 37, 91, 5  # spread the sampled pairs over the users
seed = SEED  # a small deterministic generator, so every run builds the same graph


def rnd(n):
    global seed
    seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
    return (seed >> 16) % n


for u in range(CELEBRITIES, USERS):
    for _ in range(FRIENDS_EACH):
        connect(u, rnd(CELEBRITIES) if rnd(10) < CELEB_IN_10 else (u + 1 + rnd(NEIGHBOR_SPAN)) % USERS)

degrees = [len(row) for row in adj]
print(f"{USERS} users, {stats['edges']} friendships, {stats['cross']} of them across shards, biggest list {max(degrees)}, typical list {degrees[USERS // 2]}")

common, steps = mutual(USER_A, USER_B)
print(f"mutual friends of 250 and 262: [{', '.join(map(str, common))}] after {steps} steps (lists of {len(adj[USER_A])} and {len(adj[USER_B])})")

no_cap, capped = suggest(USER_A, INF), suggest(USER_A, HUB_CAP)


def show(r):
    return ' '.join(f'{i}x{c}' for i, c in r[0][:3])


print(f"suggestions for 250 without a cap: {show(no_cap)}, edges read {no_cap[1]}, shards {no_cap[2]}")
print(f"suggestions for 250 with cap {HUB_CAP}: {show(capped)}, edges read {capped[1]}, shards {capped[2]}")

pairs = sum_plain = sum_both = 0
for i in range(PAIRS):
    a, b = (i * STRIDE_A) % USERS, (i * STRIDE_B + OFFSET_B) % USERS
    (pd, ps), (qd, qs) = bfs(a, b), bidirectional(a, b)
    if pd != qd or pd < 0:
        print(f"mismatch for {a} and {b}")
        sys.exit(1)
    pairs += 1
    sum_plain += ps
    sum_both += qs
print(f"{pairs} distance queries agree; edges scanned: plain {sum_plain}, bidirectional {sum_both}")

symmetric = all(is_friend(b, a) for a, row in enumerate(adj) for b in row) and all(row == sorted(set(row)) for row in adj)
mutual_ok = all(is_friend(USER_A, c) and is_friend(USER_B, c) for c in common) and len(common) == len([c for c in adj[USER_A] if is_friend(USER_B, c)])
print(f"lists symmetric and sorted: {str(symmetric).lower()}; mutual friends match the slow check: {str(mutual_ok).lower()}")
if not symmetric or not mutual_ok or sum_both >= sum_plain or capped[1] >= no_cap[1]:
    sys.exit(1)
