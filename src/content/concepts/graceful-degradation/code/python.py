# Page assembly with per-dependency timeouts and fallbacks over a seeded set of failures.
# Compares a naive page (everything critical, no fallbacks) with a degrading one.
DEPS = [
    ("product", 80, 0),       # critical, no fallback
    ("reviews", 60, 90),      # stale cache: 90% hit
    ("recs", 120, 100),       # generic bestsellers
    ("inventory", 40, 70),    # cached stock level: 70% hit
    ("personal", 70, 100),    # default (logged-out) view
]
SCENARIOS = [
    ("healthy", {}),
    ("reviews down", {"reviews": "down"}),
    ("recs slow", {"recs": "slow"}),
    ("inventory down", {"inventory": "down"}),
    ("product down", {"product": "down"}),
]
N, CRITICAL_TIMEOUT, USABLE_MS = 100, 2000, 1000

seed = 12345


def nxt():
    global seed
    seed = (seed * 48271) % 2147483647
    return seed


# One fixed set of random draws per request, shared by every configuration.
draws = [[(nxt(), nxt()) for _ in DEPS] for _ in range(N)]


def call_dep(base, mode, a):
    if mode == "down":
        return False, 15 + a % 25  # fails fast
    if mode == "slow":
        return True, 1500 + a % 1000
    return True, base + a % base


def assemble(modes, cfg, req):
    slowest, error_at, substituted, missing = 0, -1, 0, 0
    for i, (name, base, hit) in enumerate(DEPS):
        critical = i == 0 or cfg["all_critical"]
        limit = CRITICAL_TIMEOUT if critical else cfg["optional_timeout"]
        ok, ms = call_dep(base, modes.get(name, "up"), req[i][0])
        if ok and ms > limit:
            ok, ms = False, limit  # timed out
        if ok:
            slowest = max(slowest, ms)
            continue
        if critical:
            error_at = ms if error_at < 0 else min(error_at, ms)
            continue
        slowest = max(slowest, ms)
        if cfg["fallbacks"] and req[i][1] % 100 < hit:
            substituted += 1
        else:
            missing += 1
    if error_at >= 0:
        return "error", error_at + 15
    outcome = "degraded" if substituted + missing > 0 else "full"
    return outcome, slowest + (5 if substituted > 0 else 0) + 15


CONFIGS = [
    ("naive", {"all_critical": True, "fallbacks": False, "optional_timeout": CRITICAL_TIMEOUT}),
    ("degrading", {"all_critical": False, "fallbacks": True, "optional_timeout": 300}),
]
results = {}
for label, modes in SCENARIOS:
    for cname, cfg in CONFIGS:
        pages = [assemble(modes, cfg, req) for req in draws]
        count = lambda o: sum(1 for p in pages if p[0] == o)
        lat = sorted(p[1] for p in pages)
        usable = sum(1 for p in pages if p[0] != "error" and p[1] <= USABLE_MS)
        r = {"full": count("full"), "degraded": count("degraded"), "error": count("error"), "p95": lat[N * 95 // 100], "usable": usable}
        results[label + "/" + cname] = r
        print(f"{label:<15} {cname:<10} full={r['full']:>3} degraded={r['degraded']:>3} error={r['error']:>3} p95={r['p95']:>4}ms usable={r['usable']:>3}%")

# Invariants: an optional failure never fails the degrading page; a critical failure always does.
for label, _ in SCENARIOS:
    d = results[label + "/degrading"]
    if label == "product down":
        assert d["error"] == N, "critical failure must fail every page"
    else:
        assert d["error"] == 0, "optional failure failed a page: " + label
assert results["reviews down/naive"]["error"] == N, "naive page should fail when reviews is down"
assert results["recs slow/degrading"]["p95"] <= 320, "optional timeout must bound page latency"
assert results["recs slow/naive"]["p95"] > 1000, "naive page should be slow when recs is slow"
print("invariants hold")
