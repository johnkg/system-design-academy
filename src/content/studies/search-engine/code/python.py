# A tiny search engine in Python: analysis, an inverted index with positions, AND and phrase queries,
# BM25 ranking, and document-sharded scatter-gather whose merged answer must equal the answer of one big index.
import math
import sys

STOP = {"the", "of", "a"}
BASES = ["search", "index", "shard", "rank", "segment", "term", "token", "filter", "match", "load"]
SKIP = 8  # a skip pointer every 8 postings
BM25_K1 = 1.2  # term-frequency saturation
BM25_B = 0.75  # length normalisation
MIN_DOC_WORDS = 8  # documents have 8..20 words
DOC_WORDS_SPREAD = 13
STOPWORD_ONE_IN = 5
ZIPF_DIVISOR = 100000  # r^3 / ZIPF_DIVISOR maps 0..99 onto the 10 bases, favouring low ones
DOCS = 600
RESULTS = 5  # hits per query
SHOWN = 3  # top hits printed


def stem(w):
    """Strip one suffix: ing, ed, es or s."""
    if len(w) > 5 and w.endswith("ing"):
        return w[:-3]
    if len(w) > 4 and w.endswith("ed"):
        return w[:-2]
    if len(w) > 4 and w.endswith("es"):
        return w[:-2]
    if len(w) > 3 and w.endswith("s"):
        return w[:-1]
    return w


def analyse(text):
    """Lowercase, drop stop words (their positions stay as gaps) and stem. Returns (term, position) pairs."""
    return [(stem(w), pos) for pos, w in enumerate(text.lower().split(" ")) if w not in STOP]


# Seeded generator, so every run builds the same corpus.
state = 42


def next_int(n):
    global state
    state = (state * 1664525 + 1013904223) & 0xFFFFFFFF
    return (state >> 16) % n


def make_doc():
    words = []
    for _ in range(MIN_DOC_WORDS + next_int(DOC_WORDS_SPREAD)):
        if next_int(STOPWORD_ONE_IN) == 0:
            words.append(["the", "of", "a"][next_int(len(STOP))])
            continue
        r = next_int(100)
        base = BASES[(r * r * r) // ZIPF_DIVISOR]  # low-numbered words are much more common
        es = "es" if base.endswith(("x", "ch")) else "s"
        words.append(base + ["", es, "ed", "ing"][next_int(4)])
    return " ".join(words)


docs = [make_doc() for _ in range(DOCS)]


class Index:
    def __init__(self):
        self.terms = {}   # term -> list of [doc id, positions], sorted by doc id
        self.length = {}  # doc id -> number of words

    def add(self, doc_id, text):
        self.length[doc_id] = len(text.split(" "))
        for term, pos in analyse(text):
            postings = self.terms.setdefault(term, [])
            if not postings or postings[-1][0] != doc_id:
                postings.append([doc_id, []])
            postings[-1][1].append(pos)


def advance(postings, start, target, cost):
    """First posting with id >= target, using skip pointers; cost counts every posting touched."""
    i = start
    while i + SKIP < len(postings) and postings[i + SKIP][0] <= target:
        i += SKIP
        cost[0] += 1
    while i < len(postings) and postings[i][0] < target:
        i += 1
        cost[0] += 1
    return i


def intersect(index, terms, shortest_first, cost):
    lists = [index.terms.get(t, []) for t in terms]
    if shortest_first:
        lists = sorted(lists, key=len)
    ptr = [0] * len(lists)
    out = []
    for lead in lists[0]:
        cost[0] += 1
        ok = True
        for k in range(1, len(lists)):
            ptr[k] = advance(lists[k], ptr[k], lead[0], cost)
            ok = ptr[k] < len(lists[k]) and lists[k][ptr[k]][0] == lead[0]
            if not ok:
                break
        if ok:
            out.append(lead[0])
    return out


def positions(index, term, doc_id):
    return next(p[1] for p in index.terms[term] if p[0] == doc_id)


def has_phrase(index, doc_id, terms):
    return any(all(p0 + k in positions(index, t, doc_id) for k, t in enumerate(terms)) for p0 in positions(index, terms[0], doc_id))


def bm25(index, g, terms, doc_id):
    """BM25 with global statistics, so every shard scores on the same scale."""
    score = 0.0
    for t in terms:
        df = g["df"][t]
        tf = len(positions(index, t, doc_id))
        score += math.log(1 + (g["n"] - df + 0.5) / (df + 0.5)) * (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * index.length[doc_id] / g["avg"]))
    return score


def top_k(index, g, terms, k):
    ids = intersect(index, terms, True, [0])
    return sorted(((bm25(index, g, terms, i), i) for i in ids), key=lambda r: (-r[0], r[1]))[:k]


whole = Index()
for doc_id, d in enumerate(docs):
    whole.add(doc_id, d)
shards = [Index(), Index(), Index()]
for doc_id, d in enumerate(docs):
    shards[doc_id % len(shards)].add(doc_id, d)
g = {"n": len(whole.length), "avg": sum(whole.length.values()) / len(whole.length), "df": {t: len(p) for t, p in whole.terms.items()}}

query = [t for t, _ in analyse("searching the matched tokens")]
print(f"corpus: {len(docs)} documents, {len(whole.terms)} terms; query terms: {' '.join(query)}")
print("posting list lengths: " + " ".join(f"{t}={len(whole.terms[t])}" for t in query))
in_order, shortest = [0], [0]
a = intersect(whole, query, False, in_order)
b = intersect(whole, query, True, shortest)
print(f"AND matches: {len(a)}; postings read in query order: {in_order[0]}, shortest list first: {shortest[0]}")
phrase = [i for i in a if has_phrase(whole, i, query[1:])]
print(f'phrase "{" ".join(query[1:])}" matches: {len(phrase)}')

single = top_k(whole, g, query, RESULTS)
merged = sorted((r for s in shards for r in top_k(s, g, query, RESULTS)), key=lambda r: (-r[0], r[1]))[:RESULTS]
for score, i in single[:SHOWN]:
    print(f"doc {i} score {score:.4f}: {docs[i]}")
same = single == merged
print(f"3 shards merged equals one index: {'true' if same else 'false'}")
if not same or len(a) != len(b) or shortest[0] >= in_order[0] or not phrase:
    sys.exit(1)
