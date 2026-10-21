# A preview-environment controller, in Python:
# one namespace per pull request, routing by subdomain, idle sleep, a time limit, a cap on running environments, and cleanup on merge.

IDLE, TTL, MAX_RUNNING = 30, 200, 4  # ticks of silence before sleep, ticks of life, environments allowed to run at once

class Platform:
    def __init__(self):
        self.envs = []  # one entry per open pull request, in creation order
        self.log = []
        self.stats = dict(opened=0, served=0, not_found=0, cold_starts=0, slept=0, evicted=0, merged=0, expired=0, peak=0)

    def find(self, pr):
        return next((e for e in self.envs if e["pr"] == pr), None)

    def running(self):
        return [e for e in self.envs if e["state"] == "running"]

    def note(self, now, text):
        self.log.append(f"t={now} {text}")

    # Routing: "pr-104.preview.example.com" belongs to namespace "pr-104". Anything else is not ours.
    def route(self, host):
        parts = host.split(".")
        if len(parts) == 4 and parts[0].startswith("pr-") and ".".join(parts[1:]) == "preview.example.com":
            return int(parts[0][3:])
        return -1

    def make_room(self, now):  # the quota: at most MAX_RUNNING environments run, so the least recently used one goes to sleep
        while len(self.running()) >= MAX_RUNNING:
            lru = min(self.running(), key=lambda e: e["last_hit"])  # ties keep the earliest created
            lru["state"] = "sleeping"
            self.stats["evicted"] += 1
            self.note(now, f"{lru['ns']} put to sleep to make room")

    def open(self, pr, now):
        if self.find(pr):
            return
        self.make_room(now)
        self.envs.append({"pr": pr, "ns": f"pr-{pr}", "state": "running", "created": now, "last_hit": now})
        self.stats["opened"] += 1
        self.note(now, f"pr-{pr} created")

    def hit(self, host, now):
        env = self.find(self.route(host))
        if env is None:
            self.stats["not_found"] += 1
            return
        if env["state"] == "sleeping":
            self.make_room(now)
            env["state"] = "running"
            self.stats["cold_starts"] += 1
            self.note(now, f"{env['ns']} woken by a request")
        env["last_hit"] = now
        self.stats["served"] += 1

    def merge(self, pr, now):
        if not self.find(pr):
            return
        self.envs = [e for e in self.envs if e["pr"] != pr]
        self.stats["merged"] += 1
        self.note(now, f"pr-{pr} merged and deleted")

    def tick(self, now):  # the reaper: idle environments sleep, old ones are deleted
        for e in self.envs:
            if e["state"] == "running" and now - e["last_hit"] >= IDLE:
                e["state"] = "sleeping"
                self.stats["slept"] += 1
                self.note(now, f"{e['ns']} idle, asleep")
        for e in self.envs:
            if now - e["created"] >= TTL:
                self.stats["expired"] += 1
                self.note(now, f"{e['ns']} reached its time limit, deleted")
        self.envs = [e for e in self.envs if now - e["created"] < TTL]
        self.stats["peak"] = max(self.stats["peak"], len(self.running()))

SEED, TICKS, FIRST_PR, PRS = 7, 400, 100, 10
# Each tick draws 0..99: below 6 a PR opens, below 40 a preview is visited, below 43 a PR merges, below 45 a stray host is hit.
OPEN_BELOW, HIT_BELOW, MERGE_BELOW, STRAY_BELOW = 6, 40, 43, 45
seed = SEED

def random(n):
    """Linear congruential generator (Numerical Recipes constants), high 16 bits."""
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n

p = Platform()
for t in range(TICKS):
    r, pr = random(100), FIRST_PR + random(PRS)
    if r < OPEN_BELOW:
        p.open(pr, t)
    elif r < HIT_BELOW:
        p.hit(f"pr-{pr}.preview.example.com", t)
    elif r < MERGE_BELOW:
        p.merge(pr, t)
    elif r < STRAY_BELOW:
        p.hit("www.example.com", t)
    p.tick(t)
    if len(p.running()) > MAX_RUNNING:
        raise SystemExit("quota broken")
for line in p.log[:10]:
    print(line)
s = p.stats
print(f"opened {s['opened']}, merged {s['merged']}, expired {s['expired']}, slept {s['slept']}, evicted {s['evicted']}, cold starts {s['cold_starts']}")
print(f"served {s['served']}, not found {s['not_found']}, peak running {s['peak']}, still open {len(p.envs)}")
names = {e["ns"] for e in p.envs}
unique = len(names) == len(p.envs)
within = all(TICKS - 1 - e["created"] < TTL for e in p.envs)
print(f"namespaces unique: {str(unique).lower()}; all within time limit: {str(within).lower()}")
if not unique or s["peak"] > MAX_RUNNING or s["opened"] != s["merged"] + s["expired"] + len(p.envs):
    raise SystemExit(1)
