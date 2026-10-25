# Service discovery: an orders service calls a payment service whose instances scale and crash. Deterministic, integers only.
# One step is 1 second. Instances register with a lease (TTL 30 s) and renew it with a heartbeat every 10 s. Orders sends 30
# requests per second, round-robin over the payment addresses it currently knows. A call to an address whose instance is gone fails.
import sys

HORIZON, RATE = 600, 30
TTL, HEARTBEAT, DRAIN = 30, 10, 5      # a stopping instance deregisters 5 s before it exits
DNS_TTL, IGNORED_TTL = 30, 300
INSTANCES = [  # (name, start second, end second (-1 = runs to the end), how it ends)
    ("p1", 0, -1, "runs"), ("p2", 0, 155, "crash"), ("p3", 0, 383, "crash"), ("p4", 60, 300, "stop"),
    ("p5", 60, 515, "crash"), ("p6", 245, -1, "runs"), ("p7", 420, -1, "runs"), ("p8", 470, -1, "runs"),
]
BY_NAME = {x[0]: x for x in INSTANCES}


def alive(x, t):
    return x[1] <= t and (x[2] < 0 or t < x[2])


def run(mode, retry):
    registry = {}                       # name -> second of the last renewal
    view, pending, counter, failed, sent_to_dead = [], [], 0, 0, 0
    last_seen = {}                      # dead instance -> last second the caller still listed it
    for t in range(HORIZON):
        for x in INSTANCES:
            draining = x[3] == "stop" and t >= x[2] - DRAIN
            if not alive(x, t) or draining:
                continue                # a crashed instance simply goes silent
            if t == x[1] or (t - x[1]) % HEARTBEAT == 0:
                registry[x[0]] = t      # register, then renew the lease
        for x in INSTANCES:
            if x[3] == "stop" and t == x[2] - DRAIN:
                registry.pop(x[0], None)  # clean deregistration
        for name, last in list(registry.items()):
            if t - last >= TTL:
                del registry[name]      # the lease ran out
        current = sorted(registry)

        if mode == "static" and t == 0:
            view = ["p1", "p2", "p3"]   # written into a config file once
        if mode == "dns" and t % DNS_TTL == 0:
            view = current              # the cached answer expires with the record's TTL
        if mode == "dns-ignoring-ttl" and t % IGNORED_TTL == 0:
            view = current              # the client keeps answers for 5 minutes
        if mode == "watch":
            view = current if t == 0 else pending  # pushed changes arrive 1 s later
            pending = current

        for _ in range(RATE):
            i = counter % len(view)
            counter += 1
            if alive(BY_NAME[view[i]], t):
                continue
            sent_to_dead += 1
            if retry and alive(BY_NAME[view[(i + 1) % len(view)]], t):
                continue                # another instance answers
            failed += 1
        for name in view:
            if not alive(BY_NAME[name], t):
                last_seen[name] = t
    notice = []
    for x in INSTANCES:
        if x[3] != "crash":
            continue
        last = last_seen.get(x[0])
        if last is None:
            notice.append(f"{x[0]}:never-listed")  # the caller never knew this instance existed
        elif last == HORIZON - 1:
            notice.append(f"{x[0]}:never")
        else:
            notice.append(f"{x[0]}:{last - x[2] + 1}s")
    return {"failed": failed, "sent_to_dead": sent_to_dead, "notice": " ".join(notice)}


def check(ok, msg):
    if not ok:
        print("assertion failed: " + msg, file=sys.stderr)
        sys.exit(1)


modes = [("static", False), ("dns", False), ("dns-ignoring-ttl", False), ("watch", False), ("watch", True)]
results = []
for mode, retry in modes:
    r = run(mode, retry)
    results.append(r)
    label = mode + ("+retry" if retry else "")
    print(f"{label:<17} failed={r['failed']} sent_to_dead={r['sent_to_dead']} crash_noticed_after={r['notice']}")

stat, dns, ignoring, watch, watch_retry = results
check(watch["failed"] < dns["failed"] < ignoring["failed"] < stat["failed"], "fresher lists fail less")
check(watch_retry["failed"] == 0 and watch_retry["sent_to_dead"] == watch["sent_to_dead"], "a retry hides the stale entry but does not remove it")
print("failed requests out of", HORIZON * RATE, "sent")
