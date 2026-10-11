# A tiny ReBAC evaluator (relation tuples, userset rewrites, bounded graph walk) next to an RBAC check.
# Both must give the same answers as the intent: members view their team's docs, leads edit them,
# the contractor dave views one document, and alice's note is private.
import sys

users = [("alice", "eng", "lead"), ("bob", "eng", "member"), ("carol", "finance", "lead"), ("dan", "finance", "member"), ("dave", "", "contractor")]
docs = [("eng/plan", "eng"), ("eng/spec", "eng"), ("finance/spec", "finance"), ("alice-notes", "")]

# ---- ReBAC: tuples are (object, relation, subject) ----
tuples = [
    ("group:eng", "member", "user:alice"), ("group:eng", "member", "user:bob"),
    ("group:finance", "member", "user:carol"), ("group:finance", "member", "user:dan"),
    ("folder:eng", "editor", "user:alice"), ("folder:eng", "viewer", "group:eng#member"),
    ("folder:finance", "editor", "user:carol"), ("folder:finance", "viewer", "group:finance#member"),
    ("folder:eng/specs", "parent", "folder:eng"), ("folder:finance/specs", "parent", "folder:finance"),
    ("doc:eng/plan", "parent", "folder:eng"), ("doc:eng/spec", "parent", "folder:eng/specs"),
    ("doc:finance/spec", "parent", "folder:finance/specs"),
    ("doc:eng/spec", "viewer", "user:dave"), ("doc:alice-notes", "editor", "user:alice"),
]
index = {}
for t in tuples:
    index.setdefault(t[0] + "#" + t[1], []).append(t)


def fmt(t):
    return f"{t[0]}#{t[1]}@{t[2]}"


# Rewrites: viewer = direct + editor + parent->viewer; editor = direct + parent->editor; group member = direct.
# Every tuple followed costs one hop, and the walk stops at max_depth, so a cycle or a deep tree cannot run away.
def walk(obj, rel, user, used, max_depth):
    own = index.get(obj + "#" + rel, [])
    for t in own:
        if t[2] in ("user:" + user, "user:*") and used + 1 <= max_depth:
            return [fmt(t)]
    for t in own:
        if "#" not in t[2] or used + 1 > max_depth:
            continue
        g, r = t[2].split("#")
        sub = walk(g, r, user, used + 1, max_depth)
        if sub:
            return [fmt(t)] + sub
    if obj.startswith("group:"):
        return None
    if rel == "viewer":
        sub = walk(obj, "editor", user, used, max_depth)
        if sub:
            return sub
    for t in index.get(obj + "#parent", []):
        if used + 1 > max_depth:
            continue
        sub = walk(t[2], rel, user, used + 1, max_depth)
        if sub:
            return [fmt(t)] + sub
    return None


def rebac(user, act, doc, max_depth=8):
    return walk("doc:" + doc, "editor" if act == "edit" else "viewer", user, 0, max_depth)


# ---- RBAC: roles hold (action, pattern); users hold roles ----
roles = {"eng-viewer": ("view", "eng/"), "eng-editor": ("edit", "eng/"), "finance-viewer": ("view", "finance/"), "finance-editor": ("edit", "finance/"), "eng-spec-viewer": ("view", "eng/spec"), "notes-owner": ("edit", "alice-notes")}
held = {"alice": ["eng-editor", "notes-owner"], "bob": ["eng-viewer"], "carol": ["finance-editor"], "dan": ["finance-viewer"], "dave": ["eng-spec-viewer"]}


def rbac(user, act, doc):
    for r in held.get(user, []):
        a, pat = roles[r]
        if (a == "edit" or act == "view") and (doc.startswith(pat) if pat.endswith("/") else doc == pat):
            return r
    return None


def intended(user, act, doc):
    u = next(x for x in users if x[0] == user)
    d = next(x for x in docs if x[0] == doc)
    if doc == "alice-notes":
        return user == "alice"
    if u[1] and u[1] == d[1]:
        return act == "view" or u[2] == "lead"
    return user == "dave" and doc == "eng/spec" and act == "view"


questions = [("alice", "edit", "eng/spec"), ("bob", "view", "eng/plan"), ("bob", "edit", "eng/plan"), ("dan", "view", "finance/spec"), ("dan", "view", "eng/plan"), ("dave", "view", "eng/spec"), ("dave", "view", "eng/plan"), ("bob", "view", "alice-notes")]
for u, a, d in questions:
    p, r = rebac(u, a, d), rbac(u, a, d)
    print(f"{u} {a} {d}: want={'allow' if intended(u, a, d) else 'deny'} rebac={'allow' if p else 'deny'} hops={len(p) if p else 0} rbac={'allow' if r else 'deny'} via {r or '-'}")
print("path: " + " > ".join(rebac("dan", "view", "finance/spec")))
for depth in (3, 4):
    print(f"dan view finance/spec with depth {depth}: {'allow' if rebac('dan', 'view', 'finance/spec', depth) else 'deny (fail closed)'}")

pairs = 0
for u, _, _ in users:
    for d, _ in docs:
        for a in ("view", "edit"):
            want = intended(u, a, d)
            if bool(rebac(u, a, d)) != want or bool(rbac(u, a, d)) != want:
                print(f"MISMATCH {u} {a} {d}")
                sys.exit(1)
            pairs += 1
print(f"{pairs} pairs agree; {len(tuples)} tuples vs {len(roles)} roles + {sum(len(v) for v in held.values())} assignments")
