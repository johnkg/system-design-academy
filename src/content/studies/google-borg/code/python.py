# A miniature of the Borg scheduler from Google's EuroSys 2015 paper, in Python (a teaching model, not Google's code):
# a pending queue scanned from high to low priority, feasibility checking that counts the room taken by lower-priority tasks as
# available, scoring that prefers few stranded resources and few preemptions, preemption of the lowest-priority tasks, a down
# machine whose tasks are rescheduled, and resource reclamation that lends unused production reservations to batch work.
# Everything is deterministic.

PROD, BATCH = 200, 100
machines = [
    {"name": "m1", "cpu": 10, "ram": 10, "tasks": [], "up": True},
    {"name": "m2", "cpu": 10, "ram": 10, "tasks": [], "up": True},
    {"name": "m3", "cpu": 8, "ram": 16, "tasks": [], "up": True},
]


def used(m, min_prio=0, field="cpu"):
    return sum(t[field] for t in m["tasks"] if t["prio"] >= min_prio)


def candidates(task):  # feasibility: room left after counting only tasks that cannot be evicted by this one
    return [m for m in machines if m["up"] and m["cpu"] - used(m, task["prio"], "cpu") >= task["cpu"] and m["ram"] - used(m, task["prio"], "ram") >= task["ram"]]


def score(m, task):  # lower is better
    fc = (m["cpu"] - used(m, task["prio"], "cpu") - task["cpu"]) / m["cpu"]
    fr = (m["ram"] - used(m, task["prio"], "ram") - task["ram"]) / m["ram"]
    stranded = abs(fc - fr)  # one resource left over while the other is used up
    fits_now = m["cpu"] - used(m) >= task["cpu"] and m["ram"] - used(m, 0, "ram") >= task["ram"]
    evicted = 0 if fits_now else 1  # preempting other tasks costs more than using free room
    return stranded + evicted


def place(task, pending):
    ranked = sorted(candidates(task), key=lambda m: (score(m, task), m["name"]))
    if not ranked:
        print(f"{task['name']} (priority {task['prio']}): no machine, stays pending")
        return
    best = ranked[0]
    gone = []
    while best["cpu"] - used(best) < task["cpu"] or best["ram"] - used(best, 0, "ram") < task["ram"]:
        victim = sorted(best["tasks"], key=lambda t: t["prio"])[0]  # lowest priority first
        best["tasks"].remove(victim)
        gone.append(victim)
        pending.append(victim)
    best["tasks"].append(task)
    note = f", preempting {', '.join(t['name'] for t in gone)}" if gone else ""
    print(f"{task['name']} (priority {task['prio']}, {task['cpu']} cpu, {task['ram']} ram) -> {best['name']}{note}")


def schedule(pending):  # high priority first, as the scan of the pending queue does
    pending.sort(key=lambda t: -t["prio"])
    while pending:
        place(pending.pop(0), pending)


def show():
    print(" | ".join(f"{m['name']}{'' if m['up'] else ' (down)'}: {' '.join(t['name'] for t in m['tasks']) or '-'}" for m in machines))


def task(name, prio, cpu, ram):
    return {"name": name, "prio": prio, "cpu": cpu, "ram": ram}


print("--- placing tasks")
pending = [task("web1", PROD, 4, 3), task("web2", PROD, 4, 3), task("batch1", BATCH, 5, 5), task("batch2", BATCH, 3, 8), task("batch3", BATCH, 4, 2)]
schedule(pending)
show()

print("--- a production task arrives and needs room")
pending = [task("db1", PROD, 8, 8)]
schedule(pending)
print("running now: " + " ".join(t["name"] for m in machines for t in m["tasks"]))

print("--- a machine stops answering polls")
down = next(m for m in machines if any(t["name"] == "web1" for t in m["tasks"]))
down["up"] = False
pending = down["tasks"][:]
down["tasks"].clear()
print(f"{down['name']} marked down, rescheduling: " + " ".join(t["name"] for t in pending))
schedule(pending)
show()
down["up"] = True
print(f"{down['name']} answers again: the master tells it to kill the copies that were rescheduled, leaving {len(down['tasks'])} tasks on it")

print("--- resource reclamation")
limit_cpu, usage, margin = 8, 2, 1
reservation = usage + margin
print(f"a production task asks for {limit_cpu} cpu but uses {usage}; its reservation is {reservation}, so {limit_cpu - reservation} cpu can be lent to batch tasks")
fits4 = "fits in reclaimed resources" if limit_cpu - reservation >= 4 else "does not fit"
fits6 = "fits" if limit_cpu - reservation >= 6 else "does not fit"
print(f"a batch task needing 4 cpu {fits4}; one needing 6 {fits6}")
