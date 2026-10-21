# A tiny HTTP cache that applies Cache-Control and ETag rules to a scripted request sequence.
# Time is an integer number of seconds passed in by hand, so the output is deterministic.

def parse_cc(header):
    d = {}
    for part in header.split(","):
        part = part.strip()
        if part:
            k, _, v = part.partition("=")
            d[k] = int(v) if v else True
    return d

class Origin:
    CC = {"/app.js": "max-age=60, stale-while-revalidate=30", "/index.html": "no-cache",
          "/me": "no-store", "/app.3f9a.js": "max-age=31536000, immutable"}
    CHANGES_AT = {"/app.js": 100, "/index.html": 110}   # a deploy: version 1 becomes version 2
    NEVER = 10**9  # change time for URLs that are never redeployed

    def __init__(self):
        self.requests = 0

    def version(self, url, now):
        return 2 if now >= self.CHANGES_AT.get(url, self.NEVER) else 1

    def handle(self, url, now, if_none_match):
        self.requests += 1
        ver = self.version(url, now)
        etag = f'"v{ver}"'
        if if_none_match == etag:
            return 304, self.CC[url], etag, None
        return 200, self.CC[url], etag, ver

class Cache:
    def __init__(self, origin):
        self.origin, self.store = origin, {}

    def _fetch(self, url, now, etag):
        status, cc, new_etag, ver = self.origin.handle(url, now, etag)
        if status == 304:                       # unchanged: keep the body, restart its age
            self.store[url]["stored"] = now
        elif "no-store" not in parse_cc(cc):    # no-store: never write it
            self.store[url] = {"cc": cc, "etag": new_etag, "ver": ver, "stored": now}
        return status, ver

    def get(self, url, now):
        e = self.store.get(url)
        if e is None:
            _, ver = self._fetch(url, now, None)
            return "miss", 0, ver
        cc, age = parse_cc(e["cc"]), now - e["stored"]
        life = 0 if "no-cache" in cc else cc.get("max-age", 0)
        if age < life:
            return "hit", age, e["ver"]
        if "no-cache" not in cc and age < life + cc.get("stale-while-revalidate", 0):
            stale_ver = e["ver"]
            self._fetch(url, now, e["etag"])    # background refresh, the caller does not wait
            return "swr", age, stale_ver
        status, ver = self._fetch(url, now, e["etag"])
        if status == 304:
            return "revalidated", 0, e["ver"]
        return "refetched", 0, ver

SCRIPT = [(0, "/app.js"), (0, "/index.html"), (0, "/me"), (0, "/app.3f9a.js"), (30, "/app.js"), (40, "/me"),
          (50, "/index.html"), (61, "/app.js"), (80, "/me"), (100, "/app.js"), (120, "/index.html"),
          (121, "/app.js"), (130, "/app.js"), (150, "/index.html"), (200, "/app.3f9a.js"), (300, "/app.js"),
          (100000, "/app.3f9a.js")]

origin = Origin()
cache = Cache(origin)
counts = {"hit": 0, "swr": 0, "revalidated": 0, "refetched": 0, "miss": 0}
stale_views = 0
for t, url in SCRIPT:
    outcome, age, ver = cache.get(url, t)
    stale = ver < origin.version(url, t)
    stale_views += stale
    counts[outcome] += 1
    print(f"t={t} {url} {outcome} age={age} v{ver}{' STALE' if stale else ''}")
print("hit=%d swr=%d revalidated=%d refetched=%d miss=%d origin=%d stale=%d" % (
    counts["hit"], counts["swr"], counts["revalidated"], counts["refetched"], counts["miss"], origin.requests, stale_views))

assert sum(counts.values()) == len(SCRIPT)
assert origin.requests == counts["miss"] + counts["revalidated"] + counts["refetched"] + counts["swr"]
assert "/me" not in cache.store and counts["miss"] == 6   # three first loads plus the three later /me requests
assert (counts["hit"], counts["swr"], counts["revalidated"], counts["refetched"]) == (5, 2, 3, 1)
assert stale_views == 2     # /app.js at t=100 (hit) and t=121 (swr) show v1 after the deploy
