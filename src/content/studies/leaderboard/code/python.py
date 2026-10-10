# A leaderboard split over several shards, in Python:
# each shard keeps its players sorted, the top list is a merge of every shard's top list, and a player's rank is a sum of counts.
import sys
from functools import cmp_to_key


# Better means a higher score, and when scores are equal, the lower player id (who got there first).
def better(a, b):
    return a['score'] > b['score'] or (a['score'] == b['score'] and a['id'] < b['id'])


def order(a, b):
    return -1 if better(a, b) else 1


class Shard:
    def __init__(self):
        self.sorted = []  # best first
        self.score_of = {}

    # Number of entries in this shard that are better than the given one (binary search, so it is fast with millions of entries).
    def count_better(self, entry):
        lo, hi = 0, len(self.sorted)
        while lo < hi:
            mid = (lo + hi) >> 1
            if better(self.sorted[mid], entry):
                lo = mid + 1
            else:
                hi = mid
        return lo

    def update(self, id, score):
        if id in self.score_of:
            del self.sorted[self.count_better({'id': id, 'score': self.score_of[id]})]  # remove the old entry
        self.score_of[id] = score
        self.sorted.insert(self.count_better({'id': id, 'score': score}), {'id': id, 'score': score})  # insert in its place

    def top(self, k):
        return self.sorted[:k]


class Leaderboard:
    def __init__(self, shard_count):
        self.shards = [Shard() for _ in range(shard_count)]

    def shard_of(self, id):
        return self.shards[(((id * 2654435761) & 0xFFFFFFFF) >> 16) % len(self.shards)]  # the high bits of the product are well mixed

    def update(self, id, score):
        self.shard_of(id).update(id, score)

    # The best k overall must be among the best k of some shard, so asking each shard for k is enough.
    def top(self, k):
        merged = [e for s in self.shards for e in s.top(k)]
        return sorted(merged, key=cmp_to_key(order))[:k]

    def rank(self, id):
        entry = {'id': id, 'score': self.shard_of(id).score_of.get(id)}
        return 1 + sum(s.count_better(entry) for s in self.shards)


seed = 2024


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


board = Leaderboard(5)
truth = {}  # the same scores kept the slow, obvious way, to check against
for _ in range(20000):  # 20,000 updates to 2,000 players, so most players are updated many times
    id, score = random(2000), random(1000)
    board.update(id, score)
    truth[id] = score

all_players = sorted(({'id': id, 'score': score} for id, score in truth.items()), key=cmp_to_key(order))
top = board.top(5)
print(f"top 5: {', '.join(f'#{e['id']} ({e['score']})' for e in top)}")
probe = all_players[1234]['id']
print(f"player #{probe} has score {truth[probe]} and rank {board.rank(probe)}; the full sort says {1234 + 1}")

same_top = board.top(100) == all_players[:100]
same_rank = all(i % 97 != 0 or board.rank(e['id']) == i + 1 for i, e in enumerate(all_players))  # spot-check every 97th player
print(f"top 100 matches the full sort: {str(same_top).lower()}; ranks match: {str(same_rank).lower()}")
if not same_top or not same_rank or board.rank(probe) != 1235:
    sys.exit(1)
