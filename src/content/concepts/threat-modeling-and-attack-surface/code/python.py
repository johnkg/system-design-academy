# Threat modeling for a toy photo-sharing app: a list of threats (one per data flow, tagged with a STRIDE letter),
# scored as likelihood x impact, and a list of fixes that each remove one or more threats.
# What to look for: a model drawn only around the easy-to-list public endpoints reports "0 risk left" while about half
# of the real risk is still there, and one fix can remove threats in two different flows.
# Everything is a fixed integer table, so the output never changes. Scores are 1 to 5 and are judgement calls, not measurements.
from functools import cmp_to_key

# scope 1 = public endpoints, 2 = adds data stores and internal services, 3 = adds admin, third parties, build, backups
THREATS = [
    {"id": "t1", "flow": "login endpoint", "stride": "S", "like": 5, "impact": 4, "scope": 1},
    {"id": "t2", "flow": "photo by id endpoint", "stride": "I", "like": 4, "impact": 4, "scope": 1},
    {"id": "t3", "flow": "upload endpoint", "stride": "D", "like": 4, "impact": 2, "scope": 1},
    {"id": "t4", "flow": "comment form", "stride": "T", "like": 3, "impact": 3, "scope": 1},
    {"id": "t5", "flow": "import photo from URL", "stride": "E", "like": 3, "impact": 5, "scope": 2},
    {"id": "t6", "flow": "app to database", "stride": "I", "like": 2, "impact": 5, "scope": 2},
    {"id": "t7", "flow": "job queue to workers", "stride": "T", "like": 3, "impact": 4, "scope": 2},
    {"id": "t8", "flow": "application logs", "stride": "I", "like": 4, "impact": 3, "scope": 2},
    {"id": "t9", "flow": "admin panel", "stride": "E", "like": 3, "impact": 5, "scope": 3},
    {"id": "t10", "flow": "dependencies and CI", "stride": "T", "like": 2, "impact": 5, "scope": 3},
    {"id": "t11", "flow": "backup bucket", "stride": "I", "like": 2, "impact": 5, "scope": 3},
    {"id": "t12", "flow": "who deleted a photo", "stride": "R", "like": 3, "impact": 2, "scope": 3},
]
FIXES = [
    {"id": "F1", "name": "MFA and login rate limits", "cost": 3, "removes": ["t1", "t9"]},
    {"id": "F2", "name": "owner check on every photo read", "cost": 2, "removes": ["t2"]},
    {"id": "F3", "name": "upload size and type limits", "cost": 1, "removes": ["t3"]},
    {"id": "F4", "name": "encode output", "cost": 1, "removes": ["t4"]},
    {"id": "F5", "name": "egress allow-list for the importer", "cost": 2, "removes": ["t5"]},
    {"id": "F6", "name": "least-privilege database account", "cost": 2, "removes": ["t6"]},
    {"id": "F7", "name": "authenticate service-to-service calls", "cost": 3, "removes": ["t7"]},
    {"id": "F8", "name": "scrub logs and keep an audit trail", "cost": 2, "removes": ["t8", "t12"]},
    {"id": "F9", "name": "pin dependencies, scope CI secrets", "cost": 2, "removes": ["t10"]},
    {"id": "F10", "name": "private, encrypted backup bucket", "cost": 1, "removes": ["t11"]},
]


def risk(t):
    return t["like"] * t["impact"]


def total(items):
    return sum(risk(t) for t in items)


# How to order the fixes: "value" = visible risk removed per unit of cost, "biggest" = fix the single worst threat first,
# "cheap" = cheapest first (the easy wins feel productive). Ties go to the fix listed first.
def order(visible, ranking):
    def gain(f):
        return total([t for t in visible if t["id"] in f["removes"]])

    def top(f):
        return max([0] + [risk(t) for t in visible if t["id"] in f["removes"]])

    cmp = {
        "value": lambda a, b: gain(b) * a["cost"] - gain(a) * b["cost"],
        "biggest": lambda a, b: top(b) - top(a),
        "cheap": lambda a, b: a["cost"] - b["cost"],
    }[ranking]
    return sorted([f for f in FIXES if gain(f) > 0], key=cmp_to_key(lambda a, b: cmp(a, b) or FIXES.index(a) - FIXES.index(b)))


def run(scope, budget, ranking):
    visible = [t for t in THREATS if t["scope"] <= scope]
    left = budget
    picked = []
    for f in order(visible, ranking):
        if f["cost"] <= left:
            picked.append(f)
            left -= f["cost"]
    gone = {i for f in picked for i in f["removes"]}
    real_left = [t for t in THREATS if t["id"] not in gone]
    seen_left = [t for t in visible if t["id"] not in gone]
    return {"picked": picked, "spent": budget - left, "seen_left": total(seen_left), "real_left": total(real_left), "removed": total(THREATS) - total(real_left)}


print(f"threats: {len(THREATS)}, total risk {total(THREATS)}")
for s in range(1, 4):
    v = [t for t in THREATS if t["scope"] <= s]
    print(f"scope {s}: {len(v)} threats seen, risk seen {total(v)}, risk not seen {total(THREATS) - total(v)}")
for ranking in ["value", "biggest", "cheap"]:
    for budget in [5, 8, 19]:
        for scope in range(1, 4):
            r = run(scope, budget, ranking)
            pct = (100 * r["removed"]) // total(THREATS)
            ids = ",".join(f["id"] for f in r["picked"])
            print(f"{ranking} budget {budget} scope {scope}: spent {r['spent']}, model says left {r['seen_left']}, really left {r['real_left']}, removed {r['removed']} ({pct}%), fixes {ids}")
