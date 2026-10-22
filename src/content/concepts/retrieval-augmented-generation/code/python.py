# A tiny RAG retriever in Python: chunk, score with term overlap weighted by idf, optionally rerank, pack into a token budget.
# No embeddings: the scorer is lexical, which is enough to show where chunk size, top-k and the budget change the answer.
import re
import sys

DOCS = {
    "returns": "Returns policy. Customers may return unused accessories such as cables and cases within 14 days of delivery. Opened software cannot be refunded. Refunds go back to the original payment method within 5 business days. Returns of laptops are accepted within 30 days of delivery if the device works and all original packaging is included. Gift purchases can be returned for store credit only.",
    "shipping": "Shipping and delivery. Standard delivery takes 3 to 5 days and express delivery takes 1 to 2 days. A laptop ships in a padded box and needs a signature on delivery. After delivery you can track the parcel for 30 days. Delivery to islands can take 10 days.",
    "warranty": "Laptop warranty. The warranty covers defects for 12 months after delivery. To claim, send the laptop back to a service centre with the order number. We repair or replace the laptop within 21 days. Damage from liquids is not covered.",
    "payments": "Payments. We accept cards and bank transfer. Invoices are due in 30 days. A failed payment is retried twice before the order is cancelled.",
}
ANSWER = "laptops are accepted within 30 days of delivery"
MIN_STEM_LENGTH = 4  # only words of 4+ letters lose a plural "s"
IDF_SCALE = 4096  # fixed-point scale for n / df
TOKENS_PER_10_WORDS, CITATION_TOKENS = 13, 6  # about 1.3 tokens per word plus a citation header
TF_CAP = 2  # a term counts at most twice per chunk
RERANK_POOL, RERANK_WINDOW, RERANK_WEIGHT = 8, 12, 4  # rerank the 8 best by their densest 12-word window
STOP = set("how can i a an the of to is are in on and or for after you your with by it".split(" "))


def words(t):
    return [w for w in re.sub(r"[^a-z0-9 ]", " ", t.lower()).split(" ") if w]


def stem(w):
    return w[:-1] if len(w) >= MIN_STEM_LENGTH and w.endswith("s") else w


# integer idf in half-octave steps: rarer terms weigh more, and every language computes the same number
def idf_of(n, df):
    x = (IDF_SCALE * n) // df
    b = x.bit_length() - 1
    return 2 * b + ((x // 2 ** (b - 1)) % 2 if b >= 1 else 0)


def tokens_of(word_count):
    return (word_count * TOKENS_PER_10_WORDS + 9) // 10 + CITATION_TOKENS  # rounded up


def chunk(size, overlap):
    if overlap >= size:
        raise ValueError("overlap must be smaller than the chunk size")
    out = []
    for doc, text in DOCS.items():
        w = words(text)
        s, n = 0, 0
        while True:
            out.append({"id": f"{doc}#{n}", "doc": doc, "words": w[s:s + size], "score": 0})
            if s + size >= len(w):
                break
            s += size - overlap
            n += 1
    return out


def retrieve(query, size, overlap, k, rerank, budget):
    chunks = chunk(size, overlap)
    terms = list(dict.fromkeys(stem(w) for w in words(query) if w not in STOP))
    idf = {}
    for t in terms:
        df = sum(1 for c in chunks if t in [stem(x) for x in c["words"]])
        if df:
            idf[t] = idf_of(len(chunks), df)
    for c in chunks:
        stems = [stem(x) for x in c["words"]]
        c["score"] = sum(idf.get(t, 0) * min(stems.count(t), TF_CAP) for t in terms)
    order = lambda c: (-c["score"], c["id"])
    ranked = sorted((c for c in chunks if c["score"] > 0), key=order)
    if rerank:  # second stage on the 8 best candidates: reward a dense 12 word window instead of scattered matches
        ranked = ranked[:RERANK_POOL]
        for c in ranked:
            stems = [stem(x) for x in c["words"]]
            best = 0
            for s in range(len(stems)):
                best = max(best, sum(idf.get(t, 0) for t in terms if t in stems[s:s + RERANK_WINDOW]))
            c["score"] = best * RERANK_WEIGHT + c["score"] // RERANK_WEIGHT
        ranked.sort(key=order)
    context, used = [], 0
    for c in ranked[:k]:  # greedy packing: stop adding chunks that do not fit
        cost = tokens_of(len(c["words"]))
        if used + cost <= budget:
            context.append(c)
            used += cost
    return len(chunks), ranked[:k], context, used


ANSWER_STEMS = [stem(w) for w in words(ANSWER)]


def has_answer(c):
    s = [stem(w) for w in c["words"]]
    n = len(ANSWER_STEMS)
    return any(s[i:i + n] == ANSWER_STEMS for i in range(len(s)))


Q = "how long can I send back a laptop after delivery"
configs = [  # name, options, whether the full answer sentence must reach the prompt
    ("30 words, no overlap, k=3", (30, 0, 3, False, 300), False),
    ("30 words, overlap 10, k=3", (30, 10, 3, False, 300), True),
    ("20 words, overlap 10, k=5", (20, 10, 5, False, 300), False),
    ("same + rerank", (20, 10, 5, True, 300), True),
    ("60 words, k=3, budget 60", (60, 0, 3, False, 60), False),
]
for name, o, expected in configs:
    n, top, context, used = retrieve(Q, *o)
    hit = any(has_answer(c) for c in context)
    print(f"{name}: {n} chunks, top {' '.join(c['id'] + '=' + str(c['score']) for c in top)}")
    print(f"  context {used}/{o[4]} tokens, answer sentence intact: {str(hit).lower()}")
    if hit != expected or used > o[4]:
        sys.exit(1)
