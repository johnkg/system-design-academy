# Infrastructure as code in Python: diff desired state against real state into a plan, apply it, and prove a second apply changes nothing.
# A resource key is "type.name"; its value is a flat dict of attributes. Changing an immutable attribute forces replacement.
import copy

IMMUTABLE = {"vpc": ["cidr"], "subnet": ["cidr"], "server": ["image", "subnet"], "db": ["engine"]}


def canon(state):
    return sorted((k, sorted(v.items())) for k, v in state.items())


def diff_attrs(old, new):
    names = sorted(set(old) | set(new))
    return [(n, old.get(n, "(none)"), new.get(n, "(none)")) for n in names if old.get(n) != new.get(n)]


def plan(desired, actual):
    steps = []
    for key in sorted(set(desired) | set(actual)):
        if key not in actual:
            steps.append({"action": "create", "key": key, "changes": []})
            continue
        if key not in desired:
            steps.append({"action": "destroy", "key": key, "changes": []})
            continue
        changes = diff_attrs(actual[key], desired[key])
        if not changes:
            continue  # already matches: nothing to do
        kind = key.split(".")[0]
        forced = any(name in IMMUTABLE[kind] for name, _, _ in changes)
        steps.append({"action": "replace" if forced else "update", "key": key, "changes": changes})
    return steps


def apply(actual, steps, desired):
    calls = 0
    for s in steps:
        if s["action"] == "destroy":
            del actual[s["key"]]
            calls += 1
        else:
            actual[s["key"]] = copy.deepcopy(desired[s["key"]])
            calls += 2 if s["action"] == "replace" else 1  # replace = destroy + create
    return calls


SIGN = {"create": "+", "update": "~", "replace": "-/+", "destroy": "-"}


def show(steps):
    if not steps:
        print("  No changes. Real state matches the code.")
    for s in steps:
        why = ", ".join(f"{n}: {a} -> {b}" for n, a, b in s["changes"])
        print(f"  {SIGN[s['action']]} {s['action']} {s['key']}" + (f" ({why})" if why else "") + (" forces replacement" if s["action"] == "replace" else ""))
    n = lambda a: sum(1 for s in steps if s["action"] == a)
    print(f"  Plan: {n('create')} create, {n('update')} update, {n('replace')} replace, {n('destroy')} destroy")


def run(title, desired, actual):
    print(title)
    steps = plan(desired, actual)
    show(steps)
    calls = apply(actual, steps, desired)
    print(f"  applied with {calls} API calls")
    again = plan(desired, actual)
    if again or apply(actual, again, desired) != 0:
        raise SystemExit("apply is not idempotent")
    if canon(actual) != canon(desired):
        raise SystemExit("real state differs from desired")
    print("  second apply: 0 changes")


def web(size, image="ami-1"):
    return {"size": size, "image": image, "subnet": "subnet.app"}


def db(engine, storage):
    return {"engine": engine, "storage": storage}


actual = {}  # nothing exists yet

v1 = {
    "vpc.main": {"cidr": "10.0.0.0/16"}, "subnet.app": {"cidr": "10.0.1.0/24"},
    "server.web-1": web("small"), "server.web-2": web("small"), "db.main": db("postgres15", "20"),
}
run("1. first apply", v1, actual)

v2 = copy.deepcopy(v1)
v2["server.web-1"]["size"] = "medium"  # in place
del v2["server.web-2"]
v2["server.web-3"] = web("small")  # a rename is a delete plus a create
v2["db.main"]["engine"] = "postgres16"  # immutable: the database is replaced and its data is lost
run("2. edit the code", v2, actual)

actual["server.web-1"]["size"] = "large"  # someone clicked in the console
run("3. drift: web-1 was resized by hand", v2, actual)
print("all invariants held")
