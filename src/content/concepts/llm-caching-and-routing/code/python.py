# LLM caching and routing: an exact cache, a semantic cache (toy 4-number "embeddings") and a
# two-model cascade, replayed over the same seeded workload. All money is integer nano-dollars.
import math
import sys

VEC = [[9, 1, 2, 0], [9, 1, 2, 2], [1, 9, 0, 1], [1, 8, 1, 3], [0, 1, 9, 2], [2, 0, 3, 9]]
WEIGHT = [30, 20, 20, 10, 12, 8]  # how often each question topic is asked
TENANT_SPECIFIC = [False, False, False, False, True, True]  # answer depends on who asks
PRICE = {"small": (150, 600), "large": (3000, 15000)}  # nano-dollars per input / output token
IN_TOK, OUT_TOK = 800, 150


def make_workload(n):
    s = 7

    def rnd(m):
        nonlocal s
        s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
        return (s >> 16) % m

    work = []
    for i in range(n):
        tenant = rnd(2)
        r = rnd(100)
        intent, acc = 0, 0
        for k in range(6):
            acc += WEIGHT[k]
            if r < acc:
                intent = k
                break
        wording = rnd(3)  # 3 fixed wordings per topic
        fresh = rnd(100) < 40  # 40% of questions use brand-new wording
        noise = [rnd(3) - 1, rnd(3) - 1, rnd(3) - 1, rnd(3) - 1]
        hard = rnd(100) < 30
        small_ok = (rnd(100) < 25) if hard else True
        conf = ((rnd(60) if rnd(100) < 75 else 70 + rnd(30)) if hard else 70 + rnd(30))
        wobble = [[0, 0, 0, 0], [-1, 0, 1, 0], [0, 1, 0, -1]][wording]
        vec = [v + (noise[d] if fresh else wobble[d]) for d, v in enumerate(VEC[intent])]
        key = "u%d" % i if fresh else "%d:%d" % (intent, wording)
        work.append({"tenant": tenant, "intent": intent, "key": key, "vec": vec, "small_ok": small_ok, "conf": conf})
    return work


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def sim_ok(a, b, thr):
    d = dot(a, b)
    return d > 0 and d * d * 1000000 >= thr * thr * dot(a, a) * dot(b, b)


def permille(a, b):
    return math.floor(1000 * dot(a, b) / math.sqrt(dot(a, a) * dot(b, b)))


def call_cost(m):
    return IN_TOK * PRICE[m][0] + OUT_TOK * PRICE[m][1]


def run(work, cache, thr=950, isolate=True, route="large", escalate=65):
    store = []  # each entry: key, tenant, intent, vec, ok
    cost = hits = wrong = 0
    for q in work:
        hit = None
        for e in store:
            if isolate and e["tenant"] != q["tenant"]:
                continue
            match = e["key"] == q["key"] if cache == "exact" else (cache == "semantic" and sim_ok(q["vec"], e["vec"], thr))
            if match and (hit is None or permille(q["vec"], e["vec"]) > permille(q["vec"], hit["vec"])):
                hit = e
        if hit is not None:
            hits += 1
            leaked = TENANT_SPECIFIC[q["intent"]] and hit["tenant"] != q["tenant"]
            if leaked or hit["intent"] != q["intent"] or not hit["ok"]:
                wrong += 1
            continue
        ok = True
        if route == "large":
            cost += call_cost("large")
        else:
            cost += call_cost("small")
            ok = q["small_ok"]
            if route == "cascade" and q["conf"] < escalate:
                cost += call_cost("large")
                ok = True
        if not ok:
            wrong += 1
        if cache != "none":
            store.append({"key": q["key"], "tenant": q["tenant"], "intent": q["intent"], "vec": q["vec"], "ok": ok})
    return cost, hits, wrong


work = make_workload(240)
base = len(work) * call_cost("large")
print("one large call = %d nano-dollars, one small call = %d" % (call_cost("large"), call_cost("small")))
configs = [
    ("no cache, large model", dict(cache="none")),
    ("exact cache", dict(cache="exact")),
    ("semantic 0.90", dict(cache="semantic", thr=900)),
    ("semantic 0.95", dict(cache="semantic", thr=950)),
    ("semantic 0.99", dict(cache="semantic", thr=990)),
    ("semantic 0.95 shared", dict(cache="semantic", thr=950, isolate=False)),
    ("small model only", dict(cache="none", route="small")),
    ("cascade, escalate <65", dict(cache="none", route="cascade")),
    ("semantic 0.98 + cascade", dict(cache="semantic", thr=980, route="cascade")),
]
R = {}
for label, cfg in configs:
    cost, hits, wrong = run(work, **cfg)
    R[label] = (cost, hits, wrong)
    saved = (100 * (base - cost)) // base
    print("%s cost=%du$ saved=%d%% hits=%d wrong=%d" % (label.ljust(24), cost // 1000, saved, hits, wrong))
if R["no cache, large model"][2] != 0:
    sys.exit(1)
if not R["semantic 0.90"][2] > R["semantic 0.99"][2]:
    sys.exit(1)
if not R["semantic 0.95 shared"][2] > R["semantic 0.95"][2]:
    sys.exit(1)
if not R["cascade, escalate <65"][2] < R["small model only"][2]:
    sys.exit(1)
if not R["cascade, escalate <65"][0] < base:
    sys.exit(1)
print("invariants hold")
