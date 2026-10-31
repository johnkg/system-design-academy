# Inverted index: tokenise documents, map each term to a sorted postings list, merge lists for AND/OR, rank with TF-IDF.
import math
import re

DOCS = [
    "Red apple pie recipe",
    "Green apple juice and red apple cider",
    "Apple pie with cream",
    "Red wine, red grapes and red jam",
    "Grape juice recipe",
    "Pie crust recipe with butter",
]
STOP_WORDS = {"and", "with", "the", "a", "of"}
MIN_LENGTH_FOR_PLURAL = 4  # "grapes" loses its s, "is" and "us" keep it
TOP_RESULTS = 3
SCORE_DECIMALS = 3
SEGMENT_SPLIT = 3  # documents 0..2 go to segment A, the rest to segment B


def tokenize(text):
    # Lowercase, split on anything that is not a letter, drop stop words, strip a plural s.
    words = [w for w in re.split(r"[^a-z]+", text.lower()) if w and w not in STOP_WORDS]
    return [w[:-1] if len(w) >= MIN_LENGTH_FOR_PLURAL and w.endswith("s") and not w.endswith("ss") else w for w in words]


def build_index(docs, first_id):
    # term -> postings list of (doc id, term frequency), sorted by doc id because documents are added in order.
    index = {}
    for i, text in enumerate(docs):
        counts = {}
        for t in tokenize(text):
            counts[t] = counts.get(t, 0) + 1
        for t, tf in counts.items():
            index.setdefault(t, []).append((first_id + i, tf))
    return index


def merge_segments(a, b):
    # Join the postings lists of two segments (segment B's ids are all larger, so order is kept).
    merged = {t: list(p) for t, p in a.items()}
    for t, p in b.items():
        merged.setdefault(t, []).extend(p)
    return merged


def intersect(a, b):
    # Two sorted id lists walked with one pointer each: no sorting, no nested loop.
    out, i, j = [], 0, 0
    while i < len(a) and j < len(b):
        if a[i] == b[j]:
            out.append(a[i]); i += 1; j += 1
        elif a[i] < b[j]:
            i += 1
        else:
            j += 1
    return out


def union(a, b):
    out, i, j = [], 0, 0
    while i < len(a) or j < len(b):
        if j >= len(b) or (i < len(a) and a[i] < b[j]):
            out.append(a[i]); i += 1
        elif i >= len(a) or b[j] < a[i]:
            out.append(b[j]); j += 1
        else:
            out.append(a[i]); i += 1; j += 1
    return out


index = build_index(DOCS, 0)


def ids(term):
    return [d for d, _ in index.get(term, [])]


def show(items):
    return " ".join(str(x) for x in items) if items else "none"


print(f"docs: {len(DOCS)}, distinct terms: {len(index)}")
for term in ["apple", "juice", "pie", "red"]:
    print(f"{term} -> " + " ".join(f"{d}:{tf}" for d, tf in index[term]))
print(f"AND apple pie -> {show(intersect(ids('apple'), ids('pie')))}")
print(f"OR juice grape -> {show(union(ids('juice'), ids('grape')))}")


def search(query, k):
    # Rare terms matter more: idf = ln(1 + N / df). Score of a document = sum of tf * idf over the query terms.
    scores = {}
    for term in set(tokenize(query)):
        postings = index.get(term, [])
        idf = math.log(1 + len(DOCS) / len(postings))
        for d, tf in postings:
            scores[d] = scores.get(d, 0) + tf * idf
    return sorted(scores.items(), key=lambda x: (-x[1], x[0]))[:k]


query = "red apple juice"
print(f"ranked: {query}")
for d, score in search(query, TOP_RESULTS):
    print(f"  doc {d} {score:.{SCORE_DECIMALS}f} {DOCS[d]}")

# New documents go into a small new segment; merging segments gives the same index as building once.
seg_a = build_index(DOCS[:SEGMENT_SPLIT], 0)
seg_b = build_index(DOCS[SEGMENT_SPLIT:], SEGMENT_SPLIT)
merged = merge_segments(seg_a, seg_b)
same = merged == index
print(f"segments: A has {len(seg_a)} terms, B has {len(seg_b)}, merged has {len(merged)}, same as one build: {'yes' if same else 'no'}")
