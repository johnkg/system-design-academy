"""A service registry in Python: heartbeats renew leases, a sweep evicts expired ones,
self-preservation stops the sweep when too many renewals vanish at once, and a client cache follows a versioned event log."""
import sys

TTL, EVERY, N, THRESHOLD = 30, 10, 20, 85  # seconds, seconds, instances, percent


class Registry:
    def __init__(self, self_preservation):
        self.sp = self_preservation
        self.last = {}        # instance id -> time of its last heartbeat
        self.renewals = []    # the times of recent heartbeats
        self.log = []         # versioned changes that watchers receive
        self.skipped = 0

    def heartbeat(self, instance_id, now):
        if instance_id not in self.last:  # an unknown id registers again
            self.log.append((len(self.log) + 1, "add", instance_id))
        self.last[instance_id] = now
        self.renewals.append(now)

    def sweep(self, now):
        self.renewals = [t for t in self.renewals if t > now - TTL]
        expected = len(self.last) * (TTL // EVERY)
        if self.sp and len(self.renewals) * 100 < THRESHOLD * expected:
            self.skipped += 1  # too many silent: suspect the network, not the instances
            return
        for instance_id, seen in list(self.last.items()):
            if now - seen > TTL:
                del self.last[instance_id]
                self.log.append((len(self.log) + 1, "evict", instance_id))

    def listed(self):
        return sorted(self.last)


class ClientCache:
    """Applies the log in order, and would ask for a full copy if it ever saw a gap."""

    def __init__(self):
        self.version = 0
        self.items = set()

    def catch_up(self, log):
        for version, op, instance_id in [e for e in log if e[0] > self.version]:
            if version != self.version + 1:
                raise RuntimeError("gap")
            if op == "add":
                self.items.add(instance_id)
            else:
                self.items.discard(instance_id)
            self.version = version


def run(self_preservation):
    reg, cache, out = Registry(self_preservation), ClientCache(), {}
    for t in range(141):
        for instance_id in range(N):
            crashed = 8 <= instance_id < 10 and t >= 40   # two instances really die at t=40
            cut = instance_id < 8 and 40 <= t < 100       # eight healthy ones lose the registry for 60 s
            if t % EVERY == instance_id % EVERY and not crashed and not cut:
                reg.heartbeat(instance_id, t)
        reg.sweep(t)
        cache.catch_up(reg.log)
        if t in (90, 140):
            shown = reg.listed()
            missing = len([i for i in range(8) if i not in shown])
            dead = len([i for i in shown if i in (8, 9)])
            out[t] = f"listed={len(shown)} healthy-missing={missing} dead-listed={dead}"
    if sorted(cache.items) != reg.listed():
        sys.exit(1)
    return out, reg


results = {}
for sp in (False, True):
    out, reg = run(sp)
    results[sp] = out
    label = "on " if sp else "off"
    print(f"self-preservation {label}: t=90 {out[90]} | t=140 {out[140]} | events={len(reg.log)} skipped-sweeps={reg.skipped}")
if not results[False][90].startswith("listed=10 healthy-missing=8"):
    sys.exit(1)  # without it, a partition empties the list
if "healthy-missing=0" not in results[True][90]:
    sys.exit(1)  # with it, nobody healthy is dropped
if "dead-listed=0" not in results[True][140]:
    sys.exit(1)  # and the dead are removed once the network heals
print("invariants hold")
