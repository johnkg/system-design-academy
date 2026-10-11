# Message ordering vs scale-out: competing consumers against a key-partitioned log, with retries.
# A deterministic simulation (integer maths only, so every language prints the same numbers).
import sys

KEYS, N, HOT, PARTS, BACKOFF, LATER = 12, 240, 30, 4, 5, 30
M = 0xFFFFFFFF


def fnv1a(s):  # 32-bit FNV-1a: the multiply is masked to 32 bits on purpose
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x01000193) & M
    return h


def rng(seed):  # mulberry32, returns an unsigned 32-bit integer
    a = [seed & M]

    def nxt():
        a[0] = (a[0] + 0x6D2B79F5) & M
        t = ((a[0] ^ (a[0] >> 15)) * (a[0] | 1)) & M
        t = (t ^ (t + (((t ^ (t >> 7)) * (t | 61)) & M))) & M
        return (t ^ (t >> 14)) & M

    return nxt


def make_stream():  # account events; key 0 is the hot account (30% of traffic)
    nxt, bal, seq, ev = rng(42), [0] * KEYS, [0] * KEYS, []
    for i in range(N):
        u, v, w, a, p = nxt(), nxt(), nxt(), nxt(), nxt()
        key = 0 if u % 100 < HOT else 1 + v % (KEYS - 1)
        nfail, ok = 0, True  # up to 3 failed attempts, 8% each
        for _ in range(3):
            d = nxt()
            if ok and d % 100 < 8:
                nfail += 1
            else:
                ok = False
        deposit = bal[key] < 20 or w % 2 == 0
        amount = 20 + a % 41 if deposit else 10 + a % (bal[key] - 9)  # a withdrawal never exceeds the true balance
        bal[key] += amount if deposit else -amount
        ev.append(dict(id=i, key=key, seq=seq[key], deposit=deposit, amount=amount, proc=6 + p % 9, nfail=nfail))
        seq[key] += 1
    return ev


def run(ev, partitioned, consumers, retry):  # events arrive 1 ms apart
    nq = PARTS if partitioned else 1
    qs = [[] for _ in range(nq)]
    for e in ev:
        qs[fnv1a("acct-%d" % e["key"]) % PARTS if partitioned else 0].append({"id": e["id"], "at": e["id"]})
    load, free, done, tries = [len(q) for q in qs], [0] * consumers, [0] * len(ev), [0] * len(ev)

    def owns(c):  # a group owns whole partitions
        return [i for i in range(nq) if i % consumers == c] if partitioned else [0]

    while True:
        best = None  # the consumer that can start something earliest
        for c in range(consumers):
            for qi in owns(c):
                if not qs[qi]:
                    continue
                h = qs[qi][0]
                s = max(free[c], h["at"])
                if best is None or s < best[2] or (s == best[2] and h["at"] < best[3]):
                    best = (c, qi, s, h["at"])
        if best is None:
            break
        c, qi, s, _ = best
        q = qs[qi]
        e = ev[q[0]["id"]]
        nf = 0 if retry == "none" else e["nfail"]
        if retry == "later" and tries[e["id"]] < nf:  # failed: back of the line, after its successors
            item = q.pop(0)
            tries[e["id"]] += 1
            free[c] = s + e["proc"]
            item["at"] = free[c] + LATER
            i = len(q)
            while i > 0 and q[i - 1]["at"] > item["at"]:
                i -= 1
            q.insert(i, item)
        else:  # success, or retry in place (the partition is blocked until it works)
            n = 1 if retry == "later" else nf + 1
            free[c] = done[e["id"]] = s + n * e["proc"] + (n - 1) * BACKOFF
            q.pop(0)
    order = sorted(range(len(ev)), key=lambda i: (done[i], i))
    top, bal, violations, overdrafts = [-1] * KEYS, [0] * KEYS, 0, 0
    for i in order:
        e = ev[i]
        if e["seq"] < top[e["key"]]:
            violations += 1  # finished after a later event of its key
        else:
            top[e["key"]] = e["seq"]
        if e["deposit"]:
            bal[e["key"]] += e["amount"]
        elif bal[e["key"]] >= e["amount"]:
            bal[e["key"]] -= e["amount"]
        else:
            overdrafts += 1
    return dict(throughput=len(ev) * 1000 // max(done), violations=violations, overdrafts=overdrafts, hottest=max(load))


ev = make_stream()
print("acct-0 -> fnv1a %d -> partition %d of %d" % (fnv1a("acct-0"), fnv1a("acct-0") % PARTS, PARTS))
cases = [
    ("one queue, 1 consumer", False, 1, "none"),
    ("one queue, 4 competing", False, 4, "none"),
    ("by key, 4 partitions", True, 4, "none"),
    ("by key + retry in place", True, 4, "inplace"),
    ("by key + retry later", True, 4, "later"),
]
r = {}
for name, part, cons, retry in cases:
    x = r[name] = run(ev, part, cons, retry)
    print("%s %4d ev/s  violations %2d  overdrafts %d  busiest queue %d" % (name.ljust(25), x["throughput"], x["violations"], x["overdrafts"], x["hottest"]))
bad = []
if r["one queue, 1 consumer"]["violations"] != 0: bad.append("a single consumer must be ordered")
if r["one queue, 4 competing"]["violations"] == 0: bad.append("competing consumers should reorder")
if r["by key, 4 partitions"]["violations"] != 0 or r["by key + retry in place"]["violations"] != 0: bad.append("key partitioning must keep per-key order")
if r["by key + retry later"]["violations"] == 0: bad.append("retry-later should reorder")
if r["one queue, 4 competing"]["throughput"] <= r["one queue, 1 consumer"]["throughput"]: bad.append("competing consumers should scale")
if bad:
    print("; ".join(bad), file=sys.stderr)
    sys.exit(1)
print("ok")
