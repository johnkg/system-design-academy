# A durable agent loop, in Python:
# every step is recorded in a log, tool calls carry an idempotency key, risky tools wait for approval, and budgets stop runaway runs.
import sys

TOOLS = {
    "search": {"risky": False, "cost": 120},
    "calc": {"risky": False, "cost": 60},
    "deploy": {"risky": True, "cost": 200},
}
FINISH_COST = 50  # the model call that decides to finish


class Crash(Exception):
    pass


class World:
    """The outside world: it counts how many times each tool really ran, and remembers the keys it has seen."""

    def __init__(self):
        self.effects = {"search": 0, "calc": 0, "deploy": 0}
        self.seen = {}

    def call(self, act, key):
        if key is not None and key in self.seen:
            return self.seen[key]  # a repeat of the same call: return the saved result, do nothing
        self.effects[act["tool"]] += 1
        result = f"{act['tool']}({act['arg']}) ok"
        if key is not None:
            self.seen[key] = result
        return result


def act_of(tool, arg):
    return {"tool": tool, "arg": arg}


# A stand-in for the model: it decides the next action from the step number. The real action is saved in the log.
def policy(name, i):
    if name == "good":
        return [act_of("search", "pricing"), act_of("search", "volume"), act_of("calc", "40+2"),
                act_of("deploy", "v7"), act_of("finish", "")][i]
    if name == "stuck":
        return act_of("search", "pricing")
    return act_of("search", f"q{i}")


def tokens_used(log):
    return sum(r["cost"] for r in log)


def run_agent(o):
    log = o["log"]
    i = 0
    while True:
        if tokens_used(log) >= o["budget"]:
            return "budget"
        if i >= o["max_steps"]:
            return "max-steps"
        if i < len(log):
            if log[i]["act"]["tool"] == "finish":
                return "done"
            i += 1  # already done before a crash: skip it, do not run it again
            continue
        act = policy(o["policy"], i)
        if act["tool"] == "finish":
            log.append({"act": act, "result": "done", "cost": FINISH_COST})
            return "done"
        n = len(log)
        if n >= 2 and all(r["act"] == act for r in (log[n - 1], log[n - 2])):
            return "loop"
        if TOOLS[act["tool"]]["risky"] and not o["approve"](act):
            return "denied"
        key = f"{o['name']}:{i}" if o["use_keys"] else None
        result = o["world"].call(act, key)
        if o["crash_at"] == i:
            raise Crash()  # the tool ran, but the step was not yet written to the log
        log.append({"act": act, "result": result, "cost": TOOLS[act["tool"]]["cost"]})
        i += 1


def scenario(name, **opts):
    world, log = World(), []
    o = {"name": name, "world": world, "log": log, "max_steps": 10, "budget": 1000,
         "approve": lambda act: True, "use_keys": True, "crash_at": -1}
    o.update(opts)
    resumed = "no"
    try:
        status = run_agent(o)
    except Crash:
        resumed = "yes"
        o["crash_at"] = -1  # a new worker picks up the same log
        status = run_agent(o)
    w = world.effects
    print(f"{name}: {status}, steps {len(log)}, tokens {tokens_used(log)}, resumed {resumed}, "
          f"ran search {w['search']} calc {w['calc']} deploy {w['deploy']}")
    return status, log, w


a = scenario("crash-with-keys", policy="good", crash_at=3)
b = scenario("crash-no-keys", policy="good", crash_at=3, use_keys=False)
c = scenario("denied", policy="good", approve=lambda act: False)
d = scenario("stuck", policy="stuck")
e = scenario("long", policy="long", budget=500)

ok = (a[0] == "done" and a[2]["deploy"] == 1 and len(a[1]) == 5 and b[2]["deploy"] == 2
      and c[0] == "denied" and c[2]["deploy"] == 0 and d[0] == "loop" and len(d[1]) == 2
      and e[0] == "budget" and len(e[1]) == 5)
print(f"invariants hold: {'true' if ok else 'false'}")
if not ok:
    sys.exit(1)
