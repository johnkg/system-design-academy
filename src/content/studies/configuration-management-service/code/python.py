# A configuration service in Python: schema check at publish, staged rollout with a health gate,
# automatic rollback, and clients that keep a last-known-good copy when a fetch fails or is damaged.

def fnv(s):
    h = 2166136261
    for ch in s:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h


def flat(c):  # canonical text, used for the checksum
    return f"{c['timeout_ms']}|{c['retries']}|{c['mode']}"


def validate(c):  # the schema: type and range for every key
    if not 50 <= c["timeout_ms"] <= 5000:
        return "timeout_ms must be 50..5000"
    if not 0 <= c["retries"] <= 5:
        return "retries must be 0..5"
    if c["mode"] not in ("fast", "safe"):
        return "mode must be fast or safe"
    return "ok"


class ConfigService:
    def __init__(self):
        self.versions = [None]
        self.stable = self.candidate = self.pct = 0
        self.down = False

    def publish(self, cfg):
        why = validate(cfg)
        if why != "ok":
            return f"rejected, {why}"
        self.versions.append(cfg)
        return f"ok, version {len(self.versions) - 1}"

    def fetch(self, client_id):  # a client in the first pct buckets gets the candidate, the rest get the stable version
        if self.down:
            return None
        v = self.candidate if fnv(client_id) % 100 < self.pct else self.stable
        cfg = self.versions[v]
        return {"version": v, "cfg": dict(cfg), "sum": fnv(flat(cfg))}


class Client:
    def __init__(self, client_id):
        self.id, self.version, self.cfg = client_id, 0, None

    def poll(self, service, damage=False):
        r = service.fetch(self.id)
        if r is None:
            return "kept"
        if damage:
            r["cfg"]["timeout_ms"] += 1  # simulate a corrupted payload
        if fnv(flat(r["cfg"])) != r["sum"] or validate(r["cfg"]) != "ok":
            return "kept"  # last-known-good stays
        self.version = r["version"]
        self.cfg = r["cfg"]
        return "applied"

    def failing(self):  # too short a timeout fails every call
        return self.cfg is not None and self.cfg["timeout_ms"] < 100


def rollout(service, clients, version, stages, limit):
    service.candidate = version
    for pct in stages:
        service.pct = pct
        for c in clients:
            c.poll(service)
        errors = sum(1 for c in clients if c.failing())
        print(f"  v{version} at {pct}%: {sum(1 for c in clients if c.version == version)} clients, {errors} failing")
        if errors > limit:
            service.pct = 0
            for c in clients:
                c.poll(service)
            print(f"  rolled back, {sum(1 for c in clients if c.failing())} failing")
            return False
    service.stable = version
    service.pct = 0
    for c in clients:
        c.poll(service)
    return True


svc = ConfigService()
clients = [Client(f"c{i}") for i in range(1000)]
print("publish v1:", svc.publish({"timeout_ms": 800, "retries": 2, "mode": "safe"}))
svc.stable = 1
for c in clients:
    c.poll(svc)
print("publish v2:", svc.publish({"timeout_ms": 500, "retries": 3, "mode": "fast"}))
print("publish bad:", svc.publish({"timeout_ms": 900, "retries": 9, "mode": "fast"}))
print("publish v3:", svc.publish({"timeout_ms": 60, "retries": 1, "mode": "fast"}))
ok2 = rollout(svc, clients, 2, [5, 25, 100], 10)
ok3 = rollout(svc, clients, 3, [5, 25, 100], 10)
on_v2 = sum(1 for c in clients if c.version == 2)

svc.down = True  # the service is unreachable, so every client keeps what it has
kept = sum(1 for c in clients if c.poll(svc) == "kept")
svc.down = False
damaged = clients[7].poll(svc, True)
print(f"outage: {kept} clients kept their copy; damaged payload: {damaged}, still v{clients[7].version}")
print(f"rollout v2: {str(ok2).lower()}, rollout v3: {str(ok3).lower()}, clients on v2: {on_v2}")
if not ok2 or ok3 or on_v2 != 1000 or kept != 1000 or damaged != "kept":
    raise SystemExit(1)
