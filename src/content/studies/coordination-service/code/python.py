# A tiny coordination service in Python: a replicated log with majority commit, a versioned key tree,
# compare-and-set, one-shot watches, sessions with ephemeral keys, and a lock built from sequential keys.
import sys


class Replica:
    def __init__(self):
        self.nodes, self.applied, self.up, self.slow = {}, 0, True, False

    def apply(self, op):
        n = self.nodes.get(op["path"])
        if op["t"] == "create":
            self.nodes[op["path"]] = {"data": op["data"], "ver": 0, "owner": op["owner"]}
        elif op["t"] == "set":
            self.nodes[op["path"]] = {**n, "data": op["data"], "ver": n["ver"] + 1}
        else:
            del self.nodes[op["path"]]
        self.applied += 1

class Cluster:
    def __init__(self, size):
        self.reps = [Replica() for _ in range(size)]
        self.quorum = size // 2 + 1
        self.log, self.leader, self.seq, self.sessions, self.watches, self.events = [], 0, {}, {}, {}, []

    @property
    def state(self):
        return self.reps[self.leader].nodes

    def sync(self, r):
        while r.applied < len(self.log):
            r.apply(self.log[r.applied])

    def commit(self, op):  # a write needs a majority of replicas that are up and keeping pace
        keeping = [r for r in self.reps if r.up and not r.slow]
        if len(keeping) < self.quorum:
            raise RuntimeError("no quorum")
        self.log.append(op)
        for r in keeping:
            self.sync(r)
        for w in self.watches.pop(op["path"], []):  # watches fire once
            self.events.append(f"{w} saw {op['t']} {op['path']}")
        return len(self.log)  # the position in the log doubles as a transaction id

    def create(self, path, data, owner="", sequential=False):
        if sequential:
            self.seq[path] = self.seq.get(path, 0) + 1
            path += str(self.seq[path]).zfill(3)
        return {"path": path, "zxid": self.commit({"t": "create", "path": path, "data": data, "owner": owner})}

    def set(self, path, data, expected):  # compare-and-set on the version
        if self.state[path]["ver"] != expected:
            raise RuntimeError("bad version")
        self.commit({"t": "set", "path": path, "data": data})

    def get(self, path, replica=None, sync=False):
        r = self.reps[self.leader if replica is None else replica]
        if sync:
            self.sync(r)  # a linearizable read first catches up with the leader
        return r.nodes.get(path)

    def elect(self):  # of the live replicas, the one with the longest log holds every committed entry
        live = [i for i, r in enumerate(self.reps) if r.up]
        if len(live) < self.quorum:
            raise RuntimeError("no quorum")
        self.leader = max(live, key=lambda i: (self.reps[i].applied, -i))

    def expire(self, now, timeout):  # a silent session loses its ephemeral keys
        for sid, last in list(self.sessions.items()):
            if now - last > timeout:
                del self.sessions[sid]
                for p, n in list(self.state.items()):
                    if n["owner"] == sid:
                        self.commit({"t": "delete", "path": p})

def refused(fn):
    try:
        fn()
    except RuntimeError as e:
        return str(e)


REPLICAS = 5
SESSION_TIMEOUT = 5  # a session silent this long expires
LAST_BEAT = 9  # b and c heartbeat at t=9; a went silent long before
NOW = 10

c = Cluster(REPLICAS)
c.create("/app", "")
c.create("/app/config", "v1")
c.set("/app/config", "v2", 0)
stale = refused(lambda: c.set("/app/config", "v3", 0)) == "bad version"
cfg = c.get("/app/config")
print(f"config {cfg['data']}, version {cfg['ver']}, stale writer rejected: {str(stale).lower()}")
c.reps[4].slow = True
c.set("/app/config", "v4", 1)
print(f"follower 4 says {c.get('/app/config', 4)['data']}; after a synced read it says {c.get('/app/config', 4, True)['data']}")
c.reps[4].slow = False
c.reps[3].up = c.reps[4].up = False
c.set("/app/config", "v5", 2)
c.reps[2].up = False
blocked = refused(lambda: c.set("/app/config", "v6", 3)) == "no quorum"
print(f"with 3 of 5 up the write works; with 2 of 5 up it is refused: {str(blocked).lower()}")
for r in c.reps:
    r.up = True
c.reps[0].up = False
c.elect()
print(f"leader 0 crashed, leader {c.leader} has config {c.get('/app/config')["data"]}")
c.create("/lock", "")
holders = []
for s in ["a", "b", "c"]:
    c.sessions[s] = 0
    holders.append(c.create("/lock/n-", s, s, True))
first = lambda: c.state[min(p for p in c.state if p.startswith("/lock/"))]["owner"]
print(f"lock holder {first()}, fencing token {holders[0]['zxid']}")
c.watches[holders[0]["path"]] = ["b"]
c.sessions["b"] = c.sessions["c"] = LAST_BEAT
c.expire(NOW, SESSION_TIMEOUT)
print(f"session a expired, {'; '.join(c.events)}; lock holder now {first()}, token {holders[1]['zxid']}")
if not stale or not blocked or first() != "b" or holders[1]["zxid"] <= holders[0]["zxid"]:
    sys.exit(1)
