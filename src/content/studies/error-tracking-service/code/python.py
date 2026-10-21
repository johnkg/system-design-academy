# An error tracking ingest path in Python:
# a per-project token bucket, fingerprinting by in-app stack frames, grouping, and regression detection.
import re
import sys

def fnv1a(s):
    h = 0x811C9DC5
    for ch in s:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h

def normalize(m):
    return re.sub(r"[0-9]+", "#", m)  # ids and counts in a message must not split a group

# (file, function, line in release 0). A template with no frames is a message-only error.
TEMPLATES = [
    ("TypeError", "cannot read price of item", [("cart.js", "priceOf", 40), ("cart.js", "total", 12), ("view.js", "render", 88)]),
    ("RangeError", "invalid page index", [("list.js", "slice", 7), ("list.js", "paginate", 31)]),
    ("CheckoutError", "card declined for order", [("pay.js", "charge", 55), ("checkout.js", "submit", 19)]),
    ("KeyError", "missing field user", [("api.js", "parse", 23), ("api.js", "handle", 64)]),
    ("TimeoutError", "no reply after 30 s from host 10.0.0.", []),
]
WEIGHTS = [0, 0, 0, 1, 1, 1, 2, 2, 3, 4]

ID_MIN = 1000  # messages carry a 4-digit id
ID_SPREAD = 9000
VENDOR_FNS = 3  # vendor frames run0..run2
VENDOR_LINE = 300
LINE_SHIFT = 7  # app frame lines move this much every release
FINGERPRINT_FRAMES = 3  # top app frames in a fingerprint
TICKS = 300
RELEASE_TICKS = 100  # a new release every 100 ticks
STORM_START = 100  # the api retry storm: 20 events per tick for 20 ticks
STORM_TICKS = 20
STORM_EVENTS = 20
TOP_GROUPS = 4
BUCKET_CAPACITY = 30  # per-project token bucket
BUCKET_REFILL = 3  # tokens added per tick

seed = 7

def rnd(n):
    global seed
    seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
    return (seed >> 16) % n

def make_event(release):
    idx = WEIGHTS[rnd(len(WEIGHTS))]
    if release == 1 and idx == 2:
        idx = 1  # the checkout bug is fixed in release 1
    etype, msg, tmpl = TEMPLATES[idx]
    num = rnd(ID_SPREAD) + ID_MIN
    vendor = rnd(VENDOR_FNS)
    frames = [(f, fn, line + release * LINE_SHIFT, True) for f, fn, line in tmpl]  # lines move every release
    if frames:
        frames.append(("vendor.js", "run%d" % vendor, VENDOR_LINE + vendor, False))
    return {"type": etype, "message": "%s %d" % (msg, num), "frames": frames, "release": release}

def fingerprint(e):
    app = ">".join("%s:%s" % (f[0], f[1]) for f in [f for f in e["frames"] if f[3]][:FINGERPRINT_FRAMES])
    return fnv1a("%s|%s" % (e["type"], app or normalize(e["message"])))  # no line numbers, no vendor frames

def naive_key(e):
    return fnv1a("%s|%s|" % (e["type"], e["message"]) + ">".join("%s:%s:%d" % (f[0], f[1], f[2]) for f in e["frames"]))

class Bucket:
    def __init__(self, cap, refill):
        self.cap, self.refill, self.tokens = cap, refill, cap

    def tick(self):
        self.tokens = min(self.cap, self.tokens + self.refill)

    def take(self):
        if self.tokens < 1:
            return False
        self.tokens -= 1
        return True

projects = {"web": {"bucket": Bucket(BUCKET_CAPACITY, BUCKET_REFILL), "sent": 0, "kept": 0}, "api": {"bucket": Bucket(BUCKET_CAPACITY, BUCKET_REFILL), "sent": 0, "kept": 0}}
groups, naive, regressions = {}, set(), []

for t in range(TICKS):
    release = 0 if t < RELEASE_TICKS else 1 if t < 2 * RELEASE_TICKS else 2
    if t == RELEASE_TICKS:
        for g in groups.values():
            if g["title"].startswith("CheckoutError"):
                g["status"] = "resolved"
    for name, p in projects.items():
        p["bucket"].tick()
        n = STORM_EVENTS if name == "api" and STORM_START <= t < STORM_START + STORM_TICKS else 1  # a retry storm in the api project
        for _ in range(n):
            e = make_event(release)
            p["sent"] += 1
            if not p["bucket"].take():
                continue  # over the project quota: dropped
            p["kept"] += 1
            naive.add(naive_key(e))
            key = "%s:%08x" % (name, fingerprint(e))
            g = groups.get(key)
            if g is None:
                g = {"title": "%s: %s" % (e["type"], normalize(e["message"])), "count": 0, "status": "open"}
                groups[key] = g
            elif g["status"] == "resolved":
                g["status"] = "regressed"
                regressions.append("%s at t=%d in release %d" % (key, t, e["release"]))
            g["count"] += 1

sent = projects["web"]["sent"] + projects["api"]["sent"]
kept = projects["web"]["kept"] + projects["api"]["kept"]
print("events sent %d, kept %d, dropped %d" % (sent, kept, sent - kept))
for name, p in projects.items():
    print("%s: sent %d, kept %d, dropped %d" % (name, p["sent"], p["kept"], p["sent"] - p["kept"]))
print("distinct events by naive key %d, groups by fingerprint %d" % (len(naive), len(groups)))
for key, g in sorted(groups.items(), key=lambda kv: (-kv[1]["count"], kv[0]))[:TOP_GROUPS]:
    print("%s x%d [%s] %s" % (key, g["count"], g["status"], g["title"]))
print("regressions: %s" % ("; ".join(regressions) if regressions else "none"))

total = sum(g["count"] for g in groups.values())
if total != kept or len(groups) >= len(naive) or not regressions:
    sys.exit(1)
