# Likes on a viral photo, in Python:
# a unique (post, user) row keeps repeated taps out, the counter is split over shards so no row is hot,
# and writes to the counter are batched, so the database sees a few big additions instead of thousands of small ones.
import sys

SHARDS, BATCH = 8, 500


class LikeStore:
    def __init__(self):
        self.liked = set()      # the unique (post, user) rows: a repeat is rejected here
        self.shards = {}        # post -> counter shards, each one a separate row in the database
        self.pending = {}       # "post:shard" -> likes waiting in the buffer
        self.waiting = 0
        self.counter_writes = 0  # updates that reached a counter row
        self.row_writes = {}    # "post:shard" -> updates that row received

    def like(self, post, user, pick):
        key = post * 100000 + user
        if key in self.liked:
            return False  # the unique constraint says: already liked
        self.liked.add(key)
        slot = f"{post}:{pick % SHARDS}"  # any shard will do, so choose by a random number
        self.pending[slot] = self.pending.get(slot, 0) + 1
        self.waiting += 1
        if self.waiting >= BATCH:
            self.flush()
        return True

    def flush(self):  # one update per (post, shard) that changed, however many likes it holds
        for slot, n in self.pending.items():
            post, shard = map(int, slot.split(":"))
            self.shards.setdefault(post, [0] * SHARDS)[shard] += n
            self.counter_writes += 1
            self.row_writes[slot] = self.row_writes.get(slot, 0) + 1
        self.pending.clear()
        self.waiting = 0

    def shown(self, post):  # the count a reader sees: the sum of the shards
        return sum(self.shards.get(post, []))


seed = 4242


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


store = LikeStore()
posts = [0, 1, 2]


def sum_shown():
    return sum(store.shown(p) for p in posts)


taps = []  # every tap, including repeats
accepted = behind_max = 0
for _ in range(30000):
    post = 0 if random(10) < 8 else 1 + random(2)  # 80% of the taps go to the viral post 0
    user = random(20000)
    taps.append((post, user))
    if store.like(post, user, random(1000)):
        accepted += 1
    behind_max = max(behind_max, accepted - sum_shown())  # likes in the buffer, not yet in the counters
last_behind = accepted - sum_shown()
store.flush()

truth = [len({t[1] for t in taps if t[0] == p}) for p in posts]  # the slow, obvious count
shown = [store.shown(p) for p in posts]
print(f"taps: {len(taps)}, counted once each: {accepted}, repeats rejected: {len(taps) - accepted}")
print(f"true counts: {', '.join(map(str, truth))}; counts after the last flush: {', '.join(map(str, shown))}")
print(f"the count trailed by at most {behind_max} likes, and by {last_behind} just before the final flush")
hot = [n for k, n in store.row_writes.items() if k.startswith("0:")]
print(f"counter writes: {store.counter_writes} instead of {accepted}; the hottest row got {max(hot)}, a single row would have got {truth[0]}")

ok = shown == truth and accepted == sum(truth) and store.counter_writes < accepted / 10
if not ok:
    sys.exit(1)
