# Security logging in a toy model: redaction, a hash-chained log, and detection rules over one seeded day of login events.
# Seeded generator (Park-Miller), integers only. WARNING: the hash used for the chain is a 32-bit FNV-1a STAND-IN, not secure;
# a real log chain uses a cryptographic hash or an HMAC, and keeps its head hash somewhere the attacker cannot write.


def hexs(h):
    return f"{h:08x}"


def fnv(s):
    h = 2166136261
    for c in s:
        h ^= ord(c)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


print("-- 1. what never goes in a log: secrets are redacted before the line is written")
SENSITIVE = ["password", "token", "card"]


def redact(line):
    out = []
    for kv in line.split(" "):
        if "=" not in kv:
            out.append(kv)
            continue
        k, v = kv.split("=")[0], kv.split("=")[1]
        if k not in SENSITIVE:
            out.append(kv)
        elif k == "card":
            out.append(f"{k}=****{v[-4:]}")
        else:
            out.append(f"{k}=[redacted]")
    return " ".join(out)


raw = "login_failed user=alice ip=203.0.113.7 password=hunter2 token=abc123 card=4111111111111111 reason=bad_password"
print(f"  raw:      {raw}")
print(f"  redacted: {redact(raw)}")

print("-- 2. tamper evidence: each entry commits to the one before it")
LINES = ["login ok user=alice", "role_change user=bob role=admin by=alice", "export_report user=bob rows=50000", "login ok user=carol", "delete_user user=dave by=bob"]


def chain(lines):
    prev, out = 0, []
    for l in lines:
        prev = fnv(hexs(prev) + "|" + l)
        out.append(prev)
    return out


def verify(lines, stored, anchor):
    now = chain(lines)
    for i in range(len(stored)):
        if i >= len(now) or now[i] != stored[i]:
            return f"broken at entry {i + 1}"
    if len(lines) != len(stored):
        return "chain consistent, but length differs from the stored hashes"
    if anchor is None:
        return "chain consistent, nothing outside to compare the head with"
    return "intact, head matches the anchor" if now[-1] == anchor else "chain consistent, but the head does not match the anchor: tampering detected"


stored = chain(LINES)
anchor = stored[-1]
print(f"  head hash {hexs(anchor)}, copy kept in a separate write-once store")
edited = list(LINES)
edited[1] = "role_change user=bob role=viewer by=alice"
print(f"  untouched: {verify(LINES, stored, anchor)}")
print(f"  entry 2 edited: {verify(edited, stored, anchor)}")
print(f"  entry 2 edited and every later hash recomputed, anchor kept elsewhere: {verify(edited, chain(edited), anchor)}")
print(f"  entry 2 edited and every later hash recomputed, no anchor: {verify(edited, chain(edited), None)}")
print(f"  last 2 entries deleted, hashes truncated to match: {verify(LINES[:3], chain(LINES[:3]), anchor)}")

print("-- 3. detection: failed logins over one day (1,440 minutes), 23 sources")
seed = 12345


def rnd(n):
    global seed
    seed = (seed * 48271) % 2147483647
    return seed % n


DAY, NORMAL = 1440, 20
# Sources 0..19 ordinary users (1 person each), 20 the office NAT (40 people), 21 attacker A (fast), 22 attacker B (slow and spread out).
OFFICE, A, B, SRC = 20, 21, 22, 23
USERS = [40 if i == OFFICE else 1 for i in range(SRC)]
fails = [[0] * DAY for _ in range(SRC)]
wins = [[0] * DAY for _ in range(SRC)]
for m in range(DAY):
    for s in range(SRC):
        if s < NORMAL:
            if rnd(1000) < 6:
                fails[s][m] += 1 + (1 + rnd(3) if rnd(100) < 25 else 0)  # a mistyped password, then a correct one
                if m + 1 < DAY:
                    wins[s][m + 1] = 1
        elif s == OFFICE:
            if rnd(100) < 5:
                fails[s][m] += 1
            if 540 <= m < 550:
                fails[s][m] += 3  # a password rotation notice lands at 09:00: 40 people retype
            wins[s][m] = 1  # somebody in the office logs in every minute
        elif s == A and 800 <= m < 810:
            fails[s][m] = 8
        elif s == B and 200 <= m < 500:
            fails[s][m] = 1
wins[A][810] = 1
wins[B][500] = 1  # the attackers get in
ATTACK = {A: (800, 810), B: (200, 500)}  # (start, breach)
TRIAGE, COOLDOWN = 10, 60


def total(arr, frm, to):
    return sum(arr[i] for i in range(max(0, frm), to + 1))


def detect(window, threshold, correlate, response):
    alerts = []
    last = [-1000] * SRC
    for m in range(DAY):
        for s in range(SRC):
            if m - last[s] < COOLDOWN:
                continue
            why = ""
            if total(fails[s], m - window + 1, m) >= threshold:
                why = "rate"
            elif correlate and wins[s][m] and total(fails[s], m - 15, m - 1) >= 3:
                why = "success after failures"
            if why:
                alerts.append({"t": m, "s": s})
                last[s] = m
    # One on-call engineer, first come first served, 10 minutes per alert.
    free, max_wait, blocked = 0, 0, 0
    seen_blocked = set()
    first = {A: None, B: None}
    for a in alerts:
        start = max(a["t"], free)
        free = start + TRIAGE
        max_wait = max(max_wait, start - a["t"])
        a["done"] = free
        real = a["s"] in (A, B)
        if not real and response == "auto" and a["s"] not in seen_blocked:
            seen_blocked.add(a["s"])
            blocked += USERS[a["s"]]
        if real and first[a["s"]] is None:
            first[a["s"]] = a
    false_alerts = len([1 for a in alerts if a["s"] not in (A, B)])
    who = {}
    for s in (A, B):
        a = first[s]
        if a is None:
            who[s] = "never detected"
            continue
        contained = a["t"] + 1 if response == "auto" else a["done"] + (2 if response == "runbook" else 15)
        ttd, ttc = a["t"] - ATTACK[s][0], contained - ATTACK[s][0]
        tail = "stopped before the login succeeded" if contained < ATTACK[s][1] else f"attacker had access for {contained - ATTACK[s][1]} min"
        who[s] = f"detected {ttd} min after it began, contained {ttc} min after; {tail}"
    return len(alerts), false_alerts, max_wait, blocked, who


def show(label, w, t, correlate, response):
    n, f, mw, blocked, who = detect(w, t, correlate, response)
    print(f"  {label}: alerts {n}, of which false {f}; longest wait for a look {mw} min; legit users locked out {blocked}")
    print(f"    fast attacker: {who[A]}")
    print(f"    slow attacker: {who[B]}")


show("5 min window, 3 failures, manual", 5, 3, False, "manual")
show("5 min window, 10 failures, manual", 5, 10, False, "manual")
show("5 min window, 20 failures, manual", 5, 20, False, "manual")
show("60 min window, 40 failures, manual", 60, 40, False, "manual")
show("60 min window, 40 failures, runbook", 60, 40, False, "runbook")
show("5 min window, 10 failures, auto-block", 5, 10, False, "auto")
show("5 min window, 20 failures plus success-after-failures rule, manual", 5, 20, True, "manual")
