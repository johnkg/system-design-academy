# A tiny recommender in Python: popularity, item-to-item co-occurrence, and diversity re-ranking,
# judged on one held-out interaction per user. Cold-start users fall back to popularity, and new items get an exploration slot.
import sys
from math import sqrt

USERS, GENRES, PER = 120, 6, 8
ITEMS = GENRES * PER
K = 5
NEW_ITEM = ITEMS  # item 48 is new and has no interactions


def genre_of(item):
    return item // PER


seed = 7


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


# Each user mostly likes one genre (user % 6); within a genre, the low item numbers are the popular ones.
history, held_out = [], []
for u in range(USERS):
    seen = []
    while len(seen) < 12:
        g = u % GENRES if random(10) < 8 else random(GENRES)
        item = g * PER + min(random(PER), random(PER))
        if item not in seen:
            seen.append(item)
    held_out.append(seen.pop())  # the last interaction is hidden from training and used as the test
    history.append(seen)

# "Training": count how popular each item is, and how often two items were liked by the same user.
pop = [0] * (ITEMS + 1)
co = [[0] * (ITEMS + 1) for _ in range(ITEMS + 1)]
for items in history:
    for a in items:
        pop[a] += 1
        for b in items:
            if a != b:
                co[a][b] += 1
popularity = sorted(range(ITEMS + 1), key=lambda i: (-pop[i], i))


def similarity(a, b):
    return 0 if pop[a] == 0 or pop[b] == 0 else co[a][b] / sqrt(pop[a] * pop[b])


def by_popularity(items):
    return [i for i in popularity if i not in items][:K]


# Candidates are ranked by their summed similarity to what the user already liked. A user with no history has no signal, so use popularity.
def ranked(items):
    scored = [(c, sum(similarity(h, c) for h in items)) for c in range(ITEMS + 1) if c not in items]
    return sorted(scored, key=lambda x: (-x[1], x[0]))


def by_cf(items):
    return by_popularity(items) if not items else [c for c, _ in ranked(items)[:K]]


# Greedy re-rank of the best 15: each pick divides the score of items of the same genre by 1 + (how many of that genre are already picked).
def diverse(items):
    if not items:
        return by_popularity(items)
    pool, picked = ranked(items)[:15], []
    while len(picked) < K:
        best, best_score = None, -1
        for c, s in pool:
            if c in picked:
                continue
            adj = s / (1 + sum(1 for p in picked if genre_of(p) == genre_of(c)))
            if adj > best_score:
                best, best_score = c, adj
        picked.append(best)
    return picked


# Exploration slot: for every 10th user the last slot shows the new item, so that it can start collecting interactions.
def with_explore(items, u):
    lst = diverse(items)
    return lst[:K - 1] + [NEW_ITEM] if u % 10 == 0 else lst


def evaluate(name, recommend):
    hits = new_shown = genre_sum = 0
    covered = set()
    for u in range(USERS):
        lst = recommend(history[u], u)
        hits += held_out[u] in lst
        new_shown += NEW_ITEM in lst
        covered.update(lst)
        genre_sum += len({genre_of(i) for i in lst})
    print(f"{name.ljust(18)} hits {hits}/{USERS}, items shown {len(covered)}/{ITEMS + 1}, genres per list {genre_sum / USERS:.2f}, new item shown {new_shown}")
    return {'hits': hits, 'shown': len(covered), 'genres': genre_sum / USERS, 'new_shown': new_shown}


a = evaluate('popularity', lambda items, u: by_popularity(items))
b = evaluate('item-to-item CF', lambda items, u: by_cf(items))
c = evaluate('CF + diversity', lambda items, u: diverse(items))
d = evaluate('CF + explore slot', with_explore)
cold = diverse([])
print(f"cold-start user gets the popular items: {', '.join(map(str, cold))}")

ok = (b['hits'] > a['hits'] and b['shown'] > a['shown'] and c['genres'] > b['genres'] and c['shown'] >= b['shown']
      and b['new_shown'] == 0 and d['new_shown'] == 12 and cold == popularity[:K])
print(f"CF beats popularity, diversity widens lists, new item only via exploration: {'true' if ok else 'false'}")
if not ok:
    sys.exit(1)
