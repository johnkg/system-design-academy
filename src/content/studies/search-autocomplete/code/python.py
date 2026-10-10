# A trie that stores the best suggestions at every node, in Python:
# answering a prefix is a walk down the letters of the prefix, never a search through everything that starts with it.
import sys

K = 5  # suggestions kept per node


class Node:
    def __init__(self):
        self.children = {}
        self.top = []  # the K most popular queries that pass through this node


# Order: more popular first, and alphabetical when equal, so results are the same on every run.
def better_key(e):
    return (-e["count"], e["query"])


class Trie:
    def __init__(self):
        self.root = Node()

    def insert(self, query, count):
        node = self.root
        entry = {"query": query, "count": count}
        node.top = self.keep_best(node.top, entry)
        for ch in query:
            if ch not in node.children:
                node.children[ch] = Node()
            node = node.children[ch]
            node.top = self.keep_best(node.top, entry)  # every node on the path remembers this query if it is good enough

    def keep_best(self, lst, entry):
        return sorted([*lst, entry], key=better_key)[:K]

    def suggest(self, prefix):
        node = self.root
        for ch in prefix:
            node = node.children.get(ch)
            if not node:
                return []  # nothing starts with this prefix
        return [e["query"] for e in node.top]


logs = [
    ("car insurance", 9200), ("car rental", 7400), ("cat food", 6100), ("cake recipe", 5200), ("car wash near me", 4800),
    ("cat videos", 4400), ("cars movie", 3900), ("cake pops", 1200), ("carpet cleaning", 1100), ("cabin rentals", 900),
    ("weather today", 12000), ("weather tomorrow", 5000), ("web hosting", 3100), ("wedding dresses", 2800),
]

trie = Trie()
for query, count in logs:
    trie.insert(query, count)

# Check every prefix against the slow way: scan all queries, filter, sort.
mismatches = 0
for prefix in ["c", "ca", "car", "cat", "w", "we", "wea", "x"]:
    fast = trie.suggest(prefix)
    entries = [{"query": q, "count": c} for q, c in logs if q.startswith(prefix)]
    slow = [e["query"] for e in sorted(entries, key=better_key)[:K]]
    if fast != slow:
        mismatches += 1
    print(f'"{prefix}" -> {" | ".join(fast) if fast else "(none)"}')
if mismatches > 0:
    sys.exit(1)
