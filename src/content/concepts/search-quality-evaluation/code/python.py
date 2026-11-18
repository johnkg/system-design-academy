# Judging two rankers offline: a judged set (query, document, grade 0 to 3), precision@k, recall@k and NDCG@k per query,
# and an average that depends on which queries you count and how much each one weighs. Scores print in hundredths (integers).
# grades: judged documents of the query; a, b: the ranked lists the two rankers returned; weight: share of real traffic (percent).
import math

QUERIES = [
    {"text": "iphone case", "head": True, "weight": 40, "grades": {"d1": 3, "d2": 3, "d3": 2, "d4": 2, "d5": 1, "d6": 1, "d7": 0, "d8": 0},
     "a": ["d1", "d2", "d3", "d7", "d4"], "b": ["d1", "d3", "d7", "d8", "d2"]},
    {"text": "laptop", "head": True, "weight": 25, "grades": {"d1": 3, "d2": 2, "d3": 2, "d4": 1, "d5": 1, "d6": 0, "d7": 0},
     "a": ["d1", "d2", "d3", "d4", "d6"], "b": ["d2", "d6", "d1", "d7", "d3"]},
    {"text": "headphones", "head": True, "weight": 15, "grades": {"d1": 3, "d2": 3, "d3": 2, "d4": 1, "d5": 0, "d6": 0, "d7": 0},
     "a": ["d1", "d2", "d5", "d3", "d4"], "b": ["d5", "d2", "d6", "d1", "d7"]},
    {"text": "waterproof case for iphone 12 mini", "head": False, "weight": 7, "grades": {"d1": 3, "d2": 2, "d3": 2, "d4": 1, "d5": 0, "d6": 0, "d7": 0},
     "a": ["d5", "d6", "d4", "d7", "d1"], "b": ["d2", "d5", "d6", "d1", "d4"]},
    {"text": "quiet mechanical keyboard office", "head": False, "weight": 7, "grades": {"d1": 3, "d2": 3, "d3": 1, "d4": 1, "d5": 0, "d6": 0},
     "a": ["d3", "d5", "d1", "d6", "d4"], "b": ["d3", "d5", "d6", "d1", "d4"]},
    {"text": "gift for dad who likes coffee", "head": False, "weight": 6, "grades": {"d1": 3, "d2": 2, "d3": 2, "d4": 1, "d5": 0, "d6": 0, "d7": 0, "d8": 0, "d9": 0},
     "a": ["d5", "d6", "d7", "d8", "d9"], "b": ["d1", "d2", "d3", "d4", "d5"]},
]


def hundredths(x):
    return math.floor(x * 100 + 0.5)


def dcg(grades):
    return sum((2 ** g - 1) / math.log2(i + 2) for i, g in enumerate(grades))


# A document counts as relevant when its grade is 1 or more.
def metrics(q, ranking, k):
    got = [q["grades"].get(d, 0) for d in ranking[:k]]
    relevant_total = len([g for g in q["grades"].values() if g > 0])
    hits = len([g for g in got if g > 0])
    ideal = sorted(q["grades"].values(), reverse=True)[:k]
    return {"p": hundredths(hits / k), "r": hundredths(hits / relevant_total), "ndcg": hundredths(dcg(got) / dcg(ideal))}


# Weighted average of per-query hundredths, rounded to the nearest hundredth with integer arithmetic only.
def average(values, weights):
    w = sum(weights)
    return (2 * sum(v * x for v, x in zip(values, weights)) + w) // (2 * w)


def per(k):
    return [{"a": metrics(q, q["a"], k), "b": metrics(q, q["b"], k)} for q in QUERIES]


print("per query at k = 3 and 5 (hundredths): A | B")
for i, q in enumerate(QUERIES):
    m3, m5 = per(3)[i], per(5)[i]
    print(f'  {"head" if q["head"] else "tail"} "{q["text"]}": precision@3 {m3["a"]["p"]} | {m3["b"]["p"]}, recall@5 {m5["a"]["r"]} | {m5["b"]["r"]}, NDCG@5 {m5["a"]["ndcg"]} | {m5["b"]["ndcg"]}')
m5 = per(5)
mixes = [
    ("every query counts the same", [1 for _ in QUERIES]),
    ("weighted by traffic", [q["weight"] for q in QUERIES]),
    ("head queries only", [q["weight"] if q["head"] else 0 for q in QUERIES]),
    ("tail queries only", [0 if q["head"] else q["weight"] for q in QUERIES]),
]
print("average NDCG@5 under each query mix: A | B -> winner")
winners = {}
for name, w in mixes:
    a = average([m["a"]["ndcg"] for m in m5], w)
    b = average([m["b"]["ndcg"] for m in m5], w)
    winners[name] = "tie" if a == b else "A" if a > b else "B"
    print(f"  {name}: {a} | {b} -> {winners[name]}")
a_wins = len([m for m in m5 if m["a"]["ndcg"] > m["b"]["ndcg"]])
b_wins = len([m for m in m5 if m["b"]["ndcg"] > m["a"]["ndcg"]])
print(f"per query NDCG@5: A better on {a_wins}, B better on {b_wins}")
print("one query swings the average (every query counts the same):")
for drop in [-1, 5]:
    w = [0 if i == drop else 1 for i in range(len(QUERIES))]
    a = average([m["a"]["ndcg"] for m in m5], w)
    b = average([m["b"]["ndcg"] for m in m5], w)
    label = "all 6 queries" if drop < 0 else f'without "{QUERIES[drop]["text"]}"'
    print(f"  {label}: {a} | {b} -> {'A' if a > b else 'B'}")
if winners["weighted by traffic"] == winners["tail queries only"]:
    raise SystemExit("the query mix should flip the winner")
