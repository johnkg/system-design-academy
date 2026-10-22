# An outbound mail scheduler in Python:
# one shared queue versus a queue per receiving domain, with retries, suppression of hard bounces and a sender reputation.
import sys

TENTHS = 10  # reputation is kept in tenths of a point
START_REP, BLOCK_BELOW, BOUNCE_PENALTY = 1000, 600, 10  # 100.0 points; blocklisted under 60.0; -1.0 per bad event
SEED, RECIPIENTS, ADDRESS_SALT = 99, 600, 7919  # the salt gives existence its own hash, apart from the domain
MAX_TRIES, MAX_MINUTES = 5, 400
WARMUP_START, MAX_BUDGET = 12, 60  # messages per minute: 12, 13, ... up to 60

DOMAINS = [  # share of the list, messages the domain accepts per minute, percent of addresses that do not exist, percent of attempts deferred
    {"name": "gmail.com", "weight": 50, "limit": 30, "hard": 3, "soft": 5},
    {"name": "yahoo.com", "weight": 25, "limit": 20, "hard": 4, "soft": 5},
    {"name": "corp.example", "weight": 15, "limit": 5, "hard": 2, "soft": 10},
    {"name": "tiny.org", "weight": 10, "limit": 3, "hard": 5, "soft": 5},
]


def mix(id):
    return ((id * 2654435761) & 0xFFFFFFFF) >> 16


def domain_of(id):
    r = mix(id) % 100
    for d, dm in enumerate(DOMAINS):
        if r < dm["weight"]:
            return d
        r -= dm["weight"]
    return 0


def exists(id):  # fixed per address, so a bad address always bounces
    return (mix(id + ADDRESS_SALT) % 100) >= DOMAINS[domain_of(id)]["hard"]


def run(mode, ids, suppressed, start_rep=START_REP):
    seed = SEED

    def roll():
        nonlocal seed
        seed = (seed * 1664525 + 1013904223) % 4294967296
        return (seed // 65536) % 100

    msgs = [{"id": id, "d": domain_of(id), "tries": 0, "next": 0, "done": False} for id in ids if id not in suppressed]
    s = {"sent": len(msgs), "skipped": len(ids) - len(msgs), "delivered": 0, "hard": 0, "expired": 0, "throttled": 0,
         "blocked": 0, "deferred": 0, "minutes": 0, "over_limit": 0}
    rep = start_rep  # reputation in tenths of a point; it falls fast and recovers slowly, so inside one send it only falls
    pending = len(msgs)

    def fail(m, minute):  # wait 2, 4, 8, 16 minutes
        nonlocal pending
        m["tries"] += 1
        if m["tries"] >= MAX_TRIES:
            m["done"] = True
            pending -= 1
            s["expired"] += 1
        else:
            m["next"] = minute + (1 << m["tries"])

    minute = 0
    while pending > 0 and minute < MAX_MINUTES:
        s["minutes"] = minute + 1
        used = [0 for _ in DOMAINS]
        budget = min(MAX_BUDGET, WARMUP_START + minute)  # the new IP is warmed up: its minute budget grows every minute

        def attempt(m):
            nonlocal rep, pending
            used[m["d"]] += 1
            if used[m["d"]] > DOMAINS[m["d"]]["limit"]:  # 421: slow down
                s["throttled"] += 1
                rep -= BOUNCE_PENALTY
                fail(m, minute)
            elif rep < BLOCK_BELOW:                              # 550: we are on a blocklist
                s["blocked"] += 1
                fail(m, minute)
            elif not exists(m["id"]):
                s["hard"] += 1
                rep -= BOUNCE_PENALTY
                suppressed.add(m["id"])
                m["done"] = True
                pending -= 1
            elif roll() < DOMAINS[m["d"]]["soft"]:       # 451: try again later
                s["deferred"] += 1
                fail(m, minute)
            else:
                s["delivered"] += 1
                m["done"] = True
                pending -= 1

        ready = [m for m in msgs if not m["done"] and m["next"] <= minute]
        if mode == "shared":
            for m in ready:
                if budget <= 0:
                    break
                budget -= 1
                attempt(m)
        else:
            queues = [[m for m in ready if m["d"] == d] for d in range(len(DOMAINS))]
            progress = True
            while budget > 0 and progress:
                progress = False
                for d in range(len(DOMAINS)):
                    if budget <= 0:
                        break
                    if used[d] < DOMAINS[d]["limit"] and queues[d]:
                        attempt(queues[d].pop(0))
                        budget -= 1
                        progress = True
        for d, dm in enumerate(DOMAINS):
            if mode == "perDomain" and used[d] > dm["limit"]:
                s["over_limit"] += 1
        minute += 1
    return {**s, "reputation": rep / TENTHS}


def num(x):  # print a number the way JavaScript does
    return str(int(x)) if x == int(x) else repr(x)


ids = list(range(RECIPIENTS))


def show(label, r):
    print(f"{label}: delivered {r['delivered']}, hard bounces {r['hard']}, gave up {r['expired']}, 421 throttled {r['throttled']}, 550 blocked {r['blocked']}, 451 deferred {r['deferred']}, skipped {r['skipped']}, reputation {num(r['reputation'])}, {r['minutes']} min")


shared = run("shared", ids, set())
per = run("perDomain", ids, set())
show("shared queue    ", shared)
show("queue per domain", per)

suppression = set()
first = run("perDomain", ids, suppression)  # the hard bounces of this send fill the suppression list, and the second send starts with this send's reputation
again = run("perDomain", ids, set(suppression), first["reputation"] * TENTHS)
no_list = run("perDomain", ids, set(), first["reputation"] * TENTHS)
show("second send with suppression", again)
show("second send without it      ", no_list)


def total(r):
    return r["delivered"] + r["hard"] + r["expired"]


ok = (total(shared) + shared["skipped"] == RECIPIENTS and total(per) + per["skipped"] == RECIPIENTS and per["throttled"] == 0 and per["over_limit"] == 0 and shared["throttled"] > 0
      and again["hard"] == 0 and again["skipped"] == first["hard"] and no_list["blocked"] > 0 and again["delivered"] > no_list["delivered"]
      and again["reputation"] > no_list["reputation"] and per["reputation"] > shared["reputation"])
print(f"invariants hold: {str(ok).lower()}")
if not ok:
    sys.exit(1)
