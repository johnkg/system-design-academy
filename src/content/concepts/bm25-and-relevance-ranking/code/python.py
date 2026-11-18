# Ranking 8 tiny documents three ways: plain term count, TF-IDF, and BM25 (idf x saturating tf x length normalization).
# Scores are printed in hundredths (integers), so the output is the same in every language.
import math

DOCS = [
    "cheap laptop",
    "cheap laptop with a long battery life for travel and study",
    "laptop laptop cheap laptop laptop laptop best laptop laptop laptop deals laptop laptop laptop laptop laptop laptop shop",  # keyword stuffing
    "the review tests the screen the keyboard the speakers and the fan noise of one laptop and notes that the battery lasts all day while the charger is heavy and the price is fair for the quality of the build",
    "battery packs for phones and tablets with fast charging",
    "the best laptop battery replacement guide",
    "desktop computers and monitors for the office",
    "a laptop stand for the desk",
]
QUERY = "cheap laptop battery"
STUFFED = 3  # document number of the keyword-stuffed page

tokens = [d.split(" ") for d in DOCS]
N = len(tokens)
AVG_LEN = sum(len(t) for t in tokens) / N


def doc_freq(word):
    return sum(1 for t in tokens if word in t)


# mode: "count" | "tfidf" | "bm25". k1 and b come in as integers (k1 x 10, b x 100) so no float is ever printed.
def rank(query, mode, k1x10=12, bx100=75):
    k1, b = k1x10 / 10, bx100 / 100
    terms = query.split(" ")
    scored = []
    for i, doc in enumerate(tokens):
        s = 0
        for w in terms:
            tf = doc.count(w)
            if tf == 0:
                continue
            df = doc_freq(w)
            if mode == "count":
                s += tf
            elif mode == "tfidf":
                s += tf * math.log(1 + N / df)
            else:
                s += math.log(1 + (N - df + 0.5) / (df + 0.5)) * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * len(doc) / AVG_LEN))
        scored.append((i + 1, s if mode == "count" else math.floor(s * 100 + 0.5)))
    return sorted(scored, key=lambda x: (-x[1], x[0]))


def top(r, n):
    return " ".join(f"doc{d}={h}" for d, h in r[:n])


def place(r, doc):
    return [d for d, _ in r].index(doc) + 1


print(f"{N} documents, {sum(len(t) for t in tokens)} words, longest {max(len(t) for t in tokens)} words, shortest {min(len(t) for t in tokens)}")
print(f'query "{QUERY}" (count is in occurrences, the other scores in hundredths)')
for name, mode in [("plain count", "count"), ("tf-idf", "tfidf"), ("bm25 k1=1.2 b=0.75", "bm25")]:
    r = rank(QUERY, mode)
    print(f"  {name}: {top(r, 4)}; keyword-stuffed doc{STUFFED} is number {place(r, STUFFED)}")
print("how one term saturates under BM25 (k1=1.2, average-length document), in hundredths of the term weight:")
print("  " + " ".join(f"tf{tf}={math.floor(tf * 2.2 / (tf + 1.2) * 100 + 0.5)}" for tf in [1, 2, 3, 10, 20]))
print("changing k1 (b=0.75):")
for k in [0, 12, 30]:
    print(f"  k1={k / 10:g}: {top(rank(QUERY, 'bm25', k, 75), 3)}")
print("changing b (k1=1.2):")
for b in [0, 75, 100]:
    print(f"  b={b / 100:g}: {top(rank(QUERY, 'bm25', 12, b), 3)}")
if place(rank(QUERY, "count"), STUFFED) != 1 or place(rank(QUERY, "bm25"), STUFFED) <= 1:
    raise SystemExit("the stuffed page should win on counts and lose on BM25")
