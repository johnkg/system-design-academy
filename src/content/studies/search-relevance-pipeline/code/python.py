# Learning from clicks without being fooled by position, in Python:
# the old ranking shows 8 products for one query, shoppers click more at the top, and we compare two ways to turn those clicks into a new order.
import math
import sys

relevance = [1, 0, 1, 3, 2, 0, 3, 1]          # judged grade of each product, 0 (bad) to 3 (perfect); the old ranking shows them in this order
examine = [100, 60, 40, 30, 20, 15, 10, 8]     # percent of shoppers who even look at each position
click_if_seen = [2, 10, 30, 60]                # percent who click a product they looked at, by its grade

POSITIONS, SEED = len(relevance), 7
MIN_NDCG = 0.95  # the debiased order must come this close to the ideal one
seed = SEED


def random(n):
    """Linear congruential generator (Numerical Recipes constants), high 16 bits."""
    global seed
    seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
    return (seed // 65536) % n


# Log 40,000 searches. Every search shows the products in the old order, so product i is always at position i.
searches = 40000
clicks = [0] * POSITIONS
for _ in range(searches):
    for pos in range(POSITIONS):
        looked = random(100) < examine[pos]
        if looked and random(100) < click_if_seen[relevance[pos]]:
            clicks[pos] += 1

# Naive: click-through rate per product. It mixes "good product" with "shown near the top".
naive = [c / searches for c in clicks]
# Inverse propensity: a click at a position that few people look at counts for more (divide by the chance of being looked at).
ips = [c / searches / (examine[pos] / 100) for pos, c in enumerate(clicks)]


def order_by(score):
    return sorted(range(len(score)), key=lambda i: (-score[i], i))


def dcg(order):
    return sum(((1 << relevance[item]) - 1) / math.log2(pos + 2) for pos, item in enumerate(order))


ideal = dcg(order_by(relevance))


def ndcg(order):
    return dcg(order) / ideal


old_order = [0, 1, 2, 3, 4, 5, 6, 7]
naive_order = order_by(naive)
ips_order = order_by(ips)
best_order = order_by(relevance)
join = lambda o: "".join(str(i) for i in o)
print("clicks by position: " + " ".join(str(c) for c in clicks))
print(f"old order   {join(old_order)}  NDCG {ndcg(old_order):.3f}")
print(f"naive CTR   {join(naive_order)}  NDCG {ndcg(naive_order):.3f}")
print(f"debiased    {join(ips_order)}  NDCG {ndcg(ips_order):.3f}")
print(f"ideal       {join(best_order)}  NDCG {ndcg(best_order):.3f}")

# The raw click rate puts a middling product on top just because it sat high; the debiased score finds both grade-3 products.
if ndcg(ips_order) <= ndcg(naive_order) or ips_order[0] == 0 or ndcg(ips_order) < MIN_NDCG:
    sys.exit(1)
