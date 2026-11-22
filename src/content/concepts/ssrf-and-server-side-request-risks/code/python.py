# SSRF in a toy model: an image importer that fetches a URL the user typed. There is no real network here:
# a fixed DNS table, a fixed set of redirects and 10 test URLs (3 legitimate, 7 that aim at an internal address).
# What to look for: each check blocks some attacks and is walked around by the next one (a different spelling of the same
# address, a redirect, a DNS answer that changes), and only the last variant leaves nothing reaching the inside.
# Everything is a fixed table, so the output never changes.
import re

DNS = {
    "images.example.com": ["203.0.113.10"],
    "cdn.example.com": ["203.0.113.11"],
    "partner.example.org": ["203.0.113.20"],
    "evil.example.net": ["203.0.113.66"],
    "rebind.example.net": ["203.0.113.50", "10.0.0.5"],  # first answer public, later answers internal (a short-lived record)
    "internal-admin.corp.test": ["10.0.0.5"],
    "localhost": ["127.0.0.1"],
}
# Pages that answer with a redirect. 169.254.169.254 is the link-local address cloud platforms typically use for instance metadata.
META = {"host": "169.254.169.254", "path": "/latest/meta-data/"}
REDIRECTS = {"evil.example.net/r": META, "images.example.com/go": META}
CASES = [
    {"id": "c1", "legit": True, "host": "images.example.com", "path": "/cat.png", "note": "allowed image host"},
    {"id": "c2", "legit": True, "host": "cdn.example.com", "path": "/logo.png", "note": "allowed CDN"},
    {"id": "c3", "legit": True, "host": "partner.example.org", "path": "/hook", "note": "a real partner, not on the list"},
    {"id": "c4", "legit": False, "host": "169.254.169.254", "path": "/latest/meta-data/", "note": "metadata address typed directly"},
    {"id": "c5", "legit": False, "host": "localhost", "path": "/admin", "note": "the server's own loopback"},
    {"id": "c6", "legit": False, "host": "2130706433", "path": "/admin", "note": "loopback written as one decimal number"},
    {"id": "c7", "legit": False, "host": "internal-admin.corp.test", "path": "/users", "note": "a name that resolves to a private address"},
    {"id": "c8", "legit": False, "host": "evil.example.net", "path": "/r", "note": "a public page that redirects to metadata"},
    {"id": "c9", "legit": False, "host": "images.example.com", "path": "/go", "note": "an open redirect on an allowed host"},
    {"id": "c10", "legit": False, "host": "rebind.example.net", "path": "/x", "note": "DNS says public when checked, private when fetched"},
]
VARIANTS = ["no check", "deny-list of strings", "deny-list on resolved IP", "allow-list of hosts", "allow-list + pinned IP + no redirects"]
DENY = ["localhost", "127.0.0.1", "169.254.169.254"]
BASE_ALLOW = ["images.example.com", "cdn.example.com"]


def is_private(ip):
    a, b = [int(x) for x in ip.split(".")][:2]
    return a == 0 or a == 10 or a == 127 or (a == 169 and b == 254) or (a == 192 and b == 168) or (a == 172 and 16 <= b <= 31)


# Returns (outcome, ip, trace). outcome is "served", "blocked" or "LEAK": the server connected to an internal address.
def fetch_url(variant, host, path, allow):
    trace = []
    calls = {}

    def resolve(h):
        if re.fullmatch(r"\d+", h):  # some URL parsers accept a whole address written as one number
            n = int(h)
            ip = ".".join(str(x) for x in [n // 16777216 % 256, n // 65536 % 256, n // 256 % 256, n % 256])
        elif re.fullmatch(r"\d+\.\d+\.\d+\.\d+", h):
            ip = h
        else:
            answers = DNS[h]
            i = calls.get(h, 0)
            calls[h] = i + 1
            ip = answers[min(i, len(answers) - 1)]
        trace.append(f"resolve {h} -> {ip}")
        return ip

    def stop(why):
        trace.append(f"blocked: {why}")
        return ("blocked", "", trace)

    if variant == 1 and host in DENY:
        return stop("host is on the deny-list")
    if variant == 2 and is_private(resolve(host)):
        return stop("resolved address is private")
    if variant >= 3 and host not in allow:
        return stop("host is not on the allow-list")
    pinned = ""
    if variant == 4:
        pinned = resolve(host)
        if is_private(pinned):
            return stop("resolved address is private")
    cur = {"host": host, "path": path}
    for _hops in range(4):
        ip = pinned if variant == 4 else resolve(cur["host"])
        trace.append(f"connect {ip}")
        if is_private(ip):
            return ("LEAK", ip, trace)
        nxt = REDIRECTS.get(cur["host"] + cur["path"])
        if nxt is None:
            return ("served", ip, trace)
        if variant == 4:
            return stop("redirects are not followed")
        trace.append(f"redirect to {nxt['host']}{nxt['path']}, followed without a new check")
        cur = nxt
    return stop("too many redirects")


for partner in [False, True]:
    allow = BASE_ALLOW + ["partner.example.org"] if partner else BASE_ALLOW
    print("partner.example.org added to the allow-list" if partner else "allow-list is images.example.com and cdn.example.com")
    for v, name in enumerate(VARIANTS):
        r = [(c, *fetch_url(v, c["host"], c["path"], allow)) for c in CASES]
        served = len([x for x in r if x[0]["legit"] and x[1] == "served"])
        leaks = len([x for x in r if not x[0]["legit"] and x[1] == "LEAK"])
        print(f"  {name}: legitimate served {served}/3, attacks reaching an internal address {leaks}/7")
        if not partner:
            for c, outcome, ip, _ in r:
                print(f"    {c['id']} {outcome}{' ' + ip if ip else ''} ({c['note']})")
print("trace of c9 (open redirect on an allowed host) and c10 (DNS rebinding):")
for cid in ["c9", "c10"]:
    c = next(x for x in CASES if x["id"] == cid)
    for v in [2, 3, 4]:
        print(f"  {cid} {VARIANTS[v]}: {'; '.join(fetch_url(v, c['host'], c['path'], BASE_ALLOW)[2])}")
