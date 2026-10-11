# A webhook sender in Python: signed payloads (with a rotation window), a queue per endpoint with a
# concurrency limit, exponential backoff with jitter, and a circuit breaker, so a dead endpoint cannot hurt the others.
import hashlib
import hmac
import sys


# The signature covers the timestamp and the exact body, so a captured request cannot be replayed later or edited.
def sign(secret, ts, body):
    return hmac.new(secret.encode(), f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()


def verify(secret, header, ts, body, now, tolerance=300):
    if abs(now - ts) > tolerance:  # too old (or from the future)
        return False
    want = sign(secret, ts, body)
    return any(hmac.compare_digest(sig, want) for sig in header.split(","))  # any listed signature may match


LIMIT, MAX_ATTEMPTS, TRIP, COOL, END, EPOCH = 2, 6, 3, 20, 200, 1700000000
seed = 7


def rnd(n):
    global seed
    seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
    return (seed >> 16) % n


def backoff(attempt):  # full jitter: anywhere from 1 to the cap
    return 1 + rnd(min(30, 2 * 2 ** (attempt - 1)))


# The customer side. A receiver stores event ids, so a repeated delivery is ignored instead of processed twice.
ROTATION = ["whsec_new", "whsec_old"]  # while a secret is rotated the sender signs with both


def act_flaky(i, attempt):
    if attempt > 1:
        return "ok"
    return "error" if i % 2 == 0 else "lost" if i % 3 == 0 else "ok"


def make(name, secret, act):
    return {"name": name, "secret": secret, "act": act, "queue": [], "seen": set(), "dupes": 0, "delivered": 0,
            "attempts": 0, "dropped": 0, "last": 0, "fails": 0, "open_until": 0, "opened": 0}


endpoints = [make("healthy", "whsec_new", lambda i, a: "ok"), make("flaky", "whsec_old", act_flaky),
             make("dead", "whsec_new", lambda i, a: "hang")]


def receive(ep, i, attempt, ts, body, header):
    if not verify(ep["secret"], header, ts, body, ts):
        return "error"
    how = ep["act"](i, attempt)
    if how in ("ok", "lost"):  # 'lost' = processed, but the answer never arrived
        if i in ep["seen"]:
            ep["dupes"] += 1
        else:
            ep["seen"].add(i)
    return how


def body_of(i):
    return f'{{"id":"evt_{i}","type":"invoice.paid","n":{i}}}'


for ep in endpoints:
    for i in range(1, 11):  # fan-out: one job per endpoint
        ep["queue"].append({"id": i, "attempts": 0, "ready_at": 0})

for t in range(END):
    for ep in endpoints:  # each endpoint has its own queue and its own limit
        if ep["open_until"] > t:  # breaker open: do not call it at all
            continue
        slots = 1 if ep["fails"] >= TRIP else LIMIT  # half-open: a single probe
        for job in [j for j in ep["queue"] if j["ready_at"] <= t]:
            if slots == 0:
                break
            slots -= 1
            job["attempts"] += 1
            ep["attempts"] += 1
            ts, body = EPOCH + t, body_of(job["id"])
            header = ",".join(sign(s, ts, body) for s in ROTATION)
            if receive(ep, job["id"], job["attempts"], ts, body, header) == "ok":
                ep["queue"].remove(job)
                ep["delivered"] += 1
                ep["last"] = t
                ep["fails"] = 0
            else:
                ep["fails"] += 1
                if ep["fails"] >= TRIP:
                    ep["open_until"] = t + COOL
                    ep["opened"] += 1
                if job["attempts"] >= MAX_ATTEMPTS:
                    ep["queue"].remove(job)
                    ep["dropped"] += 1
                else:
                    job["ready_at"] = t + backoff(job["attempts"])

b = body_of(1)
good = sign("whsec_demo", EPOCH, b)
print(f"signature: {good[:16]}")
checks = [verify("whsec_demo", good, EPOCH, b, EPOCH + 10), verify("whsec_demo", good, EPOCH, b.replace("1", "9", 1), EPOCH + 10),
          verify("whsec_demo", good, EPOCH, b, EPOCH + 3600)]
low = lambda x: str(x).lower()
print(f"valid: {low(checks[0])}, edited body: {low(checks[1])}, stale timestamp: {low(checks[2])}")
for ep in endpoints:
    print(f"{ep['name']}: delivered {ep['delivered']}, attempts {ep['attempts']}, dropped {ep['dropped']}, waiting {len(ep['queue'])}, "
          f"duplicates ignored {ep['dupes']}, breaker opened {ep['opened']}, last delivery at {ep['last']}")

h, f, d = endpoints
fine = (checks[0] and not checks[1] and not checks[2] and h["delivered"] == 10 and h["last"] <= 5 and h["attempts"] == 10
        and f["delivered"] == 10 and len(f["seen"]) == 10 and f["dupes"] > 0 and d["delivered"] == 0
        and d["attempts"] < 10 * MAX_ATTEMPTS and d["delivered"] + d["dropped"] + len(d["queue"]) == 10)
print(f"dead endpoint saw {d['attempts']} attempts, not {10 * MAX_ATTEMPTS}; healthy finished by tick {h['last']}")
if not fine:
    sys.exit(1)
