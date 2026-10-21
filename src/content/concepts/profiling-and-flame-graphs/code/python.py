# Build a call tree from sampled stacks (collapsed format "a;b;c count"),
# compute self and total time per function, print a text flame graph and
# check the sampled estimate against the known true proportions.
import math

ENCODE_LOOP_US = 170  # true self time of encode_loop before the regression
REGRESSION_US = 1000  # what the regression adds to encode_loop
SEED = 7
BAR_WIDTH = 40  # characters for 100% in the flame graph
SIGMA_BOUND = 5  # sampling error must stay within 5 standard deviations

# True CPU microseconds per request, by stack. encode_loop regresses by +1000.
BASE = [
    ("handler", 160), ("handler;auth", 120), ("handler;route", 80),
    ("handler;parse", 60), ("handler;parse;regex_match", 100),
    ("handler;db_query", 50), ("handler;db_query;driver_decode", 90),
    ("handler;serialize", 50), ("handler;serialize;json_encode", 90),
    ("handler;serialize;json_encode;encode_loop", ENCODE_LOOP_US),
    ("handler;audit_log", 30),
]


def truth(regressed):
    return [(s, w + REGRESSION_US if s.endswith("encode_loop") and regressed else w) for s, w in BASE]


class Rng:  # MINSTD: x = x * 48271 mod (2^31 - 1), exact in doubles and 64-bit ints
    def __init__(self, seed):
        self.x = seed

    def next(self):
        self.x = self.x * 48271 % 2147483647
        return self.x


def sample(stacks, n, seed):
    total = sum(w for _, w in stacks)
    rng, counts = Rng(seed), {}
    for _ in range(n):
        r = rng.next() % total
        for s, w in stacks:
            if r < w:
                counts[s] = counts.get(s, 0) + 1
                break
            r -= w
    return counts


def collapsed(counts):
    return "\n".join("%s %d" % (s, counts[s]) for s in sorted(counts))


class Node:
    def __init__(self, name):
        self.name, self.self_n, self.total, self.kids = name, 0, 0, {}


def build(text):
    root = Node("(all)")
    for line in text.split("\n"):
        stack, count = line.rsplit(" ", 1)
        count = int(count)
        node = root
        root.total += count
        for frame in stack.split(";"):
            node = node.kids.setdefault(frame, Node(frame))
            node.total += count
        node.self_n += count
    return root


def pct(n, total):  # one decimal, integer math only
    p = n * 1000 // total
    return "%d.%d" % (p // 10, p % 10)


def flame(node, total, depth=0, out=None):
    out = [] if out is None else out
    bar = "#" * max(1, node.total * BAR_WIDTH // total)
    out.append("%-34s %-40s %5s%% self %5s%%" % ("  " * depth + node.name, bar, pct(node.total, total), pct(node.self_n, total)))
    for k in sorted(node.kids):
        flame(node.kids[k], total, depth + 1, out)
    return out


def check(node):
    assert node.total == node.self_n + sum(k.total for k in node.kids.values())
    for k in node.kids.values():
        check(k)


def self_by_function(root):
    acc, stack = {}, [root]
    while stack:
        n = stack.pop()
        if n is not root:
            acc[n.name] = acc.get(n.name, 0) + n.self_n
        stack.extend(n.kids.values())
    return acc


N = 6000
counts = sample(truth(True), N, SEED)
root = build(collapsed(counts))
check(root)
assert root.total == N and sum(self_by_function(root).values()) == N
print("flame graph, %d samples at 100 Hz (width = share, not time):" % N)
print("\n".join(flame(root, N)))
sv = root.kids["handler"].kids["serialize"]
print("serialize: total %s%% but self %s%%" % (pct(sv.total, N), pct(sv.self_n, N)))

true = truth(True)
tt = sum(w for _, w in true)
true_self = {s.split(";")[-1]: w for s, w in true}
print("\nestimate error for audit_log (true %s%%):" % pct(true_self["audit_log"], tt))
for n in (100, 1000, 10000, 60000):
    r = build(collapsed(sample(true, n, SEED)))
    est = self_by_function(r)
    k = est.get("audit_log", 0)
    worst = 0
    for f, w in true_self.items():
        num = abs(est.get(f, 0) * tt - w * n)  # |estimate - truth| * n * tt, exact integers
        p = w / tt
        assert num / (n * tt) <= SIGMA_BOUND * math.sqrt(p * (1 - p) / n) + 1.0 / n
        worst = max(worst, num)
    print("n=%5d  audit_log samples=%4d  est %5s%%  worst error over all functions %s pts" % (n, k, pct(k, n), pct(worst, n * tt)))

base_tot = sum(w for _, w in truth(False))
print("\nregression: total %d -> %d us per request, encode_loop share %s%% -> %s%%" % (base_tot, tt, pct(ENCODE_LOOP_US, base_tot), pct(ENCODE_LOOP_US + REGRESSION_US, tt)))
assert tt == base_tot + REGRESSION_US
