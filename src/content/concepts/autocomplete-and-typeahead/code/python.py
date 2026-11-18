# Autocomplete: suggest completions of a typed prefix, most popular first. Four ways to answer, compared by how many
# entries each one looks at for one keystroke and how many entries it keeps in memory. Integers only.
QUERIES = [
    ("ipad", 5200), ("ipad case", 2100), ("ipad pro", 3300), ("iphone", 9800), ("iphone 15", 8700), ("iphone 15 case", 4100),
    ("iphone 15 pro", 3900), ("iphone charger", 2600), ("iphone case", 3000), ("ipod", 600), ("ice maker", 900),
    ("ice cream maker", 1500), ("icon pack", 300), ("ikea desk", 1800), ("ikea shelf", 1100), ("headphones", 7600),
    ("headphones wireless", 3400), ("hdmi cable", 2300), ("hard drive", 2800), ("hair dryer", 4300), ("laptop", 8100),
    ("laptop stand", 2500), ("laptop bag", 2000), ("laptop charger", 3100), ("lamp", 1400), ("keyboard", 6200),
    ("keyboard mechanical", 2900), ("kindle", 3600), ("kitchen scale", 800), ("monitor", 5900), ("monitor arm", 1700),
    ("mouse", 5400), ("mouse pad", 2200), ("microwave", 2400), ("mattress", 3700), ("phone case", 6800),
    ("phone charger", 4600), ("power bank", 3500), ("printer", 4900), ("printer ink", 2700),
]
SORTED = sorted(QUERIES, key=lambda q: q[0])  # alphabetical, for the sorted list and for tie-breaks
MAX_GRAM = 20                                 # longest prefix indexed as an edge n-gram


def pick(items, k, popular):
    ordered = sorted(items, key=lambda q: (-q[1], q[0])) if popular else items
    return [q[0] for q in ordered[:k]]


# A trie of all queries: node = {"kids": {char: node}, "query": (text, count) or None}.
root = {"kids": {}, "query": None}
nodes = 0
for q in SORTED:
    n = root
    for ch in q[0]:
        if ch not in n["kids"]:
            n["kids"][ch] = {"kids": {}, "query": None}
            nodes += 1
        n = n["kids"][ch]
    n["query"] = q


def subtree(n, out=None):
    out = [] if out is None else out
    if n["query"]:
        out.append(n["query"])
    for ch in sorted(n["kids"]):
        subtree(n["kids"][ch], out)
    return out


def size(n):
    return 1 + sum(size(c) for c in n["kids"].values())


# Method 1: sorted list. Binary search finds the first entry that could match, then the scan reads every match.
def sorted_list(prefix, k, popular):
    lo, hi, compares = 0, len(SORTED), 0
    while lo < hi:
        mid = (lo + hi) >> 1
        compares += 1
        if SORTED[mid][0] < prefix:
            lo = mid + 1
        else:
            hi = mid
    found = []
    looked = compares
    for i in range(lo, len(SORTED)):
        looked += 1
        if not SORTED[i][0].startswith(prefix):
            break  # the first non-match ends the scan
        found.append(SORTED[i])
        if not popular and len(found) == k:
            break  # alphabetical order can stop after k matches
    return pick(found, k, popular), looked, len(SORTED)


# Method 2: trie. Walk down the prefix, then visit every node under it to find the completions.
def trie(prefix, k, popular):
    n, looked = root, 0
    for ch in prefix:
        n = n["kids"].get(ch)
        if n is None:
            return [], looked, nodes
        looked += 1
    if not popular:  # depth-first in letter order, stop at k completions
        found = []

        def walk(m):
            nonlocal looked
            if len(found) >= k:
                return
            looked += 1
            if m["query"]:
                found.append(m["query"])
            for ch in sorted(m["kids"]):
                walk(m["kids"][ch])
        walk(n)
        looked -= 1  # the prefix node was already counted
        return [q[0] for q in found], looked, nodes
    looked += size(n) - 1
    return pick(subtree(n), k, True), looked, nodes


# Method 3: trie with the top k completions stored at every node. Reading the answer is the walk plus k entries.
def top_k(prefix, k, popular):
    n, looked, stored = root, 0, 0

    def count(m):
        nonlocal stored
        stored += min(k, len(subtree(m)))
        for ch in m["kids"]:
            count(m["kids"][ch])
    count(root)
    for ch in prefix:
        n = n["kids"].get(ch)
        if n is None:
            return [], looked, nodes + stored
        looked += 1
    results = pick(subtree(n), k, popular)
    return results, looked + len(results), nodes + stored


# Method 4: edge n-grams in a search index. Every query is indexed under each of its prefixes; one term lookup returns a postings list.
def edge_ngram(prefix, k, popular):
    postings = {}
    total = 0
    for q in SORTED:
        for length in range(1, min(len(q[0]), MAX_GRAM) + 1):
            postings.setdefault(q[0][:length], []).append(q)
            total += 1
    items = postings.get(prefix, [])
    return pick(items, k, popular), 1 + (len(items) if popular else min(k, len(items))), len(postings) + total


METHODS = [("sorted list + binary search", sorted_list), ("trie", trie), ("trie with top-k at each node", top_k), ("edge n-grams in an index", edge_ngram)]
print(f"{len(QUERIES)} queries, {nodes} trie nodes (distinct prefixes)")
for prefix, k, popular in [("ip", 3, True), ("i", 3, True), ("iphone 15", 3, True), ("ip", 3, False)]:
    print(f'prefix "{prefix}", top {k}, {"most popular first" if popular else "alphabetical"}')
    for name, fn in METHODS:
        results, looked, memory = fn(prefix, k, popular)
        print(f"  {name}: looked at {looked}, stores {memory}; {' | '.join(results)}")

# One person types "iphone 15 case". Gaps are the milliseconds between key presses. A request fires after a key if the typist then pauses
# for at least the debounce time (or it was the last key). The first CACHE characters are answered from a cache and never reach the backend.
GAPS = [120, 110, 140, 100, 130, 90, 250, 120, 110, 260, 130, 100, 120]
TEXT = "iphone 15 case"


def typing(debounce, cache_chars):
    lengths = [i + 1 for i in range(len(TEXT)) if debounce == 0 or i == len(TEXT) - 1 or GAPS[i] >= debounce]
    return len(lengths), len([n for n in lengths if n > cache_chars])


print(f'typing "{TEXT}" ({len(TEXT)} keystrokes)')
for d, c in [(0, 0), (0, 2), (100, 0), (200, 0), (200, 2)]:
    sent, backend = typing(d, c)
    print(f"  debounce {d} ms, cache first {c} characters: {sent} requests sent, {backend} reach the backend, {backend * 10000} for 10000 people")
if sorted_list("ip", 3, True)[0] != trie("ip", 3, True)[0] or top_k("ip", 3, True)[0] != edge_ngram("ip", 3, True)[0]:
    raise SystemExit("methods disagree")
