# A staged rollout with a canary, health gates, automatic rollback and a deploy lock, in Python.
# Error rates are counted per thousand requests so that all the arithmetic is in whole numbers.
import sys

HOSTS, CANARY, BATCH, REQS, BASE, LIMIT = 1000, 10, 100, 200, 2, 10
PER_MILLE, BUG = 1000, 30  # the bug fails 30 extra requests per thousand
NO_GATE = PER_MILLE        # a limit of 1000 per thousand never trips
SEED = 7

seed = SEED


def next_random():
    """Linear congruential generator (Numerical Recipes constants)."""
    global seed
    seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
    return seed


def fails(rate):  # one request fails with the given chance per thousand
    return ((next_random() >> 8) % PER_MILLE) < rate


fleet = [1] * HOSTS  # the version each host runs
lock = None          # the version whose deploy holds the lock, or None


# Roll a version out in waves: a small canary first, then batches. Each wave is judged by its own error rate
# before the next one starts, and a failed gate puts the previous version back on every host that changed.
def deploy(version, bug, limit, during=None):
    global lock
    if lock is not None:
        return {"status": f"refused, v{lock} is deploying", "hosts": 0, "errors": 0}
    lock = version
    try:
        previous = fleet[0]
        done = errors = 0
        size = CANARY
        while done < HOSTS:
            size = min(size, HOSTS - done)
            for i in range(done, done + size):
                fleet[i] = version
            done += size
            wave = 0
            for _ in range(size * REQS):  # traffic served by the new hosts
                if fails(BASE + bug):
                    wave += 1
            errors += wave
            if during and done == CANARY:
                during()
            if wave * PER_MILLE > size * REQS * limit:  # the gate: error rate above the limit
                for i in range(HOSTS):
                    if fleet[i] == version:
                        fleet[i] = previous
                return {"status": f"rolled back after {done} hosts", "hosts": done, "errors": errors}
            size = BATCH
        return {"status": "complete", "hosts": done, "errors": errors}
    finally:
        lock = None


def running(v):
    return fleet.count(v)


# 1. A release with a bug that fails 3% of requests, with the gate on. A second deploy tries to start during it.
second = None


def try_second():
    global second
    second = deploy(9, 0, LIMIT)


gated = deploy(2, BUG, LIMIT, try_second)
print(f"v2 with the gate: {gated['status']}, {gated['errors']} errors; v1 on {running(1)} hosts")
print(f"second deploy meanwhile: {second['status']}")

# 2. The same release with the gate switched off reaches every host.
ungated = deploy(2, BUG, NO_GATE)
print(f"v2 without a gate: {ungated['status']} on {running(2)} hosts, {ungated['errors']} errors")
fleet[:] = [1] * HOSTS

# 3. A good release passes every gate even though 0.2% of requests fail anyway.
good = deploy(3, 0, LIMIT)
print(f"v3 without the bug: {good['status']} on {running(3)} hosts, {good['errors']} errors")

ok = (gated["hosts"] == CANARY and gated["errors"] * 20 < ungated["errors"] and second["hosts"] == 0 and lock is None
      and good["status"] == "complete" and running(3) == HOSTS)
print(f"rollback worked, lock respected, no false alarm: {str(ok).lower()}")
if not ok:
    sys.exit(1)
