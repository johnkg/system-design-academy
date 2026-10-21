# A tiny orchestrator: a scheduler (filter by free CPU/memory, score by policy) and a reconcile loop
# that restores the desired replica count after a node is lost. Integers only, so output is exact.

NODE_CPU = 4000  # millicores per node
NODE_MEM = 8192  # MiB per node
NODES = 4  # nodes in the demo cluster
REPLICAS = 6  # desired replicas in the failover demo
MANY_REPLICAS = 14  # more replicas than the cluster can hold with one node down
EXPECTED_RUNNING = 12  # 3 surviving nodes x 4 pods of 1000 millicores


def make_cluster(count):
    return {"nodes": [{"name": f"n{i}", "up": True} for i in range(1, count + 1)], "pods": [], "next_id": 1}


def pods_on(c, i):
    return [p for p in c["pods"] if p["node"] == i]


# FILTER: a node is feasible if it is up and the sum of requests still fits.
# SCORE: percent of CPU + percent of memory that would be requested after placing the pod.
#        spread prefers the lowest score (emptiest), pack prefers the highest (fullest that fits).
def schedule(c, spec, policy):
    best = -1
    best_score = 0
    for i, node in enumerate(c["nodes"]):
        if not node["up"]:
            continue
        used = len(pods_on(c, i))
        cpu = used * spec["cpu"] + spec["cpu"]
        mem = used * spec["mem"] + spec["mem"]
        if cpu > NODE_CPU or mem > NODE_MEM:
            continue  # filtered out
        score = (cpu * 100) // NODE_CPU + (mem * 100) // NODE_MEM
        better = best == -1 or (score < best_score if policy == "spread" else score > best_score)
        if better:
            best = i
            best_score = score
    return best  # -1 means no node fits: the pod stays Pending


# RECONCILE: compare desired with actual, create or delete, then try to place Pending pods.
def reconcile(c, desired, spec, policy):
    while len(c["pods"]) < desired:
        c["pods"].append({"id": c["next_id"], "node": -1})
        c["next_id"] += 1
    while len(c["pods"]) > desired:
        c["pods"].pop()
    for pod in c["pods"]:
        if pod["node"] == -1:
            pod["node"] = schedule(c, spec, policy)
    return len([p for p in c["pods"] if p["node"] == -1])


def kill_node(c, i):
    c["nodes"][i]["up"] = False
    before = len(c["pods"])
    c["pods"] = [p for p in c["pods"] if p["node"] != i]  # the pods on it are gone
    return before - len(c["pods"])


def running(c):
    return len([p for p in c["pods"] if p["node"] != -1])


def counts(c):
    return " ".join(str(len(pods_on(c, i))) if n["up"] else "X" for i, n in enumerate(c["nodes"]))


def check(c, spec):
    for i in range(len(c["nodes"])):
        n = len(pods_on(c, i))
        if n * spec["cpu"] > NODE_CPU or n * spec["mem"] > NODE_MEM:
            raise RuntimeError("node over-requested")


spec = {"cpu": 1000, "mem": 1024}

for policy in ["spread", "pack"]:
    c = make_cluster(NODES)
    pending = reconcile(c, REPLICAS, spec, policy)
    print(f"{policy}: placed 6 pods -> {counts(c)} (pending {pending})")
    sizes = [len(pods_on(c, j)) for j in range(len(c["nodes"]))]
    victim = next(i for i, s in enumerate(sizes) if s == max(sizes))
    lost = kill_node(c, victim)
    print(f"{policy}: {c['nodes'][victim]['name']} died, {lost} pods lost, {running(c)} of 6 running")
    pending = reconcile(c, REPLICAS, spec, policy)
    print(f"{policy}: reconciled -> {counts(c)} (running {running(c)}, pending {pending})")
    check(c, spec)
    if running(c) != REPLICAS or pending != 0:
        raise RuntimeError("did not converge")

c = make_cluster(NODES)
reconcile(c, MANY_REPLICAS, spec, "spread")
kill_node(c, 0)
pending = reconcile(c, MANY_REPLICAS, spec, "spread")
print(f"14 replicas, 1 node down -> {counts(c)} (running {running(c)}, pending {pending})")
if running(c) != EXPECTED_RUNNING or pending != MANY_REPLICAS - EXPECTED_RUNNING:
    raise RuntimeError("expected 12 running and 2 pending")
c["nodes"][0]["up"] = True  # the node comes back
pending = reconcile(c, MANY_REPLICAS, spec, "spread")
print(f"node back -> {counts(c)} (running {running(c)}, pending {pending})")
check(c, spec)
if pending != 0:
    raise RuntimeError("pending pods should have been scheduled")
