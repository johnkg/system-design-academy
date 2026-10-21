# A dependency resolver with caret ranges, a lockfile with SHA-256 integrity, a release-age gate and scoped registries.
# The "registries" are plain dicts and "today" is a number, so the demo is deterministic and offline.
import hashlib


def vt(v):
    return tuple(int(x) for x in v.split("."))


def satisfies(v, rng):  # "^1.2.0" means >=1.2.0 <2.0.0 (majors here are all >= 1)
    if rng[0] != "^":
        return v == rng
    return vt(v) >= vt(rng[1:]) and vt(v)[0] == vt(rng[1:])[0]


def sha(code):
    return hashlib.sha256(code.encode()).hexdigest()[:8]


def rel(ver, day, deps, code):
    return {"ver": ver, "day": day, "deps": deps, "code": code}


registries = {
    "public": {
        "webfw": [rel("2.1.0", 1, {"httputil": "^1.2.0"}, "webfw 2.1.0"), rel("2.1.4", 20, {"httputil": "^1.2.0"}, "webfw 2.1.4")],
        "httputil": [rel("1.2.0", 1, {"textkit": "^3.0.0"}, "httputil 1.2.0"), rel("1.2.3", 10, {"textkit": "^3.0.0"}, "httputil 1.2.3")],
        "textkit": [rel("3.0.0", 1, {}, "textkit 3.0.0"), rel("3.0.2", 5, {}, "textkit 3.0.2")],
    },
    "private": {"acme-billing": [rel("1.4.2", 3, {}, "acme-billing 1.4.2 (internal)")]},
}
ROOT = {"webfw": "^2.1.0", "acme-billing": "^1.4.0"}


def resolve(today, lock=None, scopes=None, min_age=0):
    plan, queue = {}, sorted(ROOT.items())
    while queue:
        name, rng = queue.pop(0)
        if name in plan:
            continue
        if lock and name in lock:  # the lockfile wins: same registry, same version
            reg = lock[name]["registry"]
            pick = next(v for v in registries[reg][name] if v["ver"] == lock[name]["version"])
        else:
            scope = next((r for p, r in (scopes or {}).items() if name.startswith(p)), None)
            where = [scope] if scope else sorted(registries)  # unscoped: every registry is searched
            cands = [(r, v) for r in where for v in registries[r].get(name, [])
                     if satisfies(v["ver"], rng) and today - v["day"] >= min_age]
            reg, pick = max(cands, key=lambda c: vt(c[1]["ver"]))  # highest version wins, wherever it lives
        plan[name] = {"registry": reg, "version": pick["ver"], "hash": sha(pick["code"])}
        queue += sorted(pick["deps"].items())
    return plan


def install(plan, verify):  # download each artifact, then check it against the recorded hash
    for name, e in sorted(plan.items()):
        code = next(v["code"] for v in registries[e["registry"]][name] if v["ver"] == e["version"])
        if verify and sha(code) != e["hash"]:
            raise ValueError(f"integrity mismatch for {name}@{e['version']}: want {e['hash']} got {sha(code)}")


def show(label, plan):
    print(f"{label:<22}" + " ".join(f"{n}@{e['version']}/{e['registry'][:3]}" for n, e in sorted(plan.items())))


LOCK_DAY = 30  # the day the lockfile is written
ATTACK_DAY = 40  # the day the malicious releases appear
TODAY = 41
MIN_AGE_DAYS = 3  # quarantine: ignore releases younger than this

lock = resolve(LOCK_DAY, scopes={"acme-": "private"})
show("day 30 fresh + lock", lock)
registries["public"]["httputil"].append(rel("1.2.9", ATTACK_DAY, {"textkit": "^3.0.0"}, "httputil 1.2.9 + steal(env)"))
registries["public"]["acme-billing"] = [rel("1.99.0", ATTACK_DAY, {}, "acme-billing 1.99.0 (attacker)")]
floating = resolve(TODAY)
locked = resolve(TODAY, lock=lock)
gated = resolve(TODAY, min_age=MIN_AGE_DAYS, scopes={"acme-": "private"})
scoped = resolve(TODAY, scopes={"acme-": "private"})
show("day 41 floating", floating)
show("day 41 lockfile", locked)
show("day 41 age gate 3d", gated)
show("day 41 scoped only", scoped)
registries["public"]["httputil"].pop()  # yanked on day 43
registries["public"]["httputil"][-1]["code"] = "httputil 1.2.3 + backdoor"  # same version, new bytes on a mirror
install(lock, verify=False)
print("lock without check:   installed tampered bytes silently")
try:
    install(lock, verify=True)
    raise SystemExit("tampered artifact was accepted")
except ValueError as e:
    print("lock with sha256:     " + str(e))

assert floating["httputil"]["version"] == "1.2.9" and locked == lock
assert floating["acme-billing"]["registry"] == "public" and scoped["acme-billing"]["registry"] == "private"
assert gated["httputil"]["version"] == "1.2.3"
print("invariants hold")
