# CIDR math with plain integers: parse, describe, split, overlap check and longest-prefix match.
import sys

IPV4_BITS = 32
OCTET_VALUES = 256  # values per dotted-quad octet
RESERVED_PER_SUBNET = 5  # network, router, DNS, future use, broadcast
FIRST_HOST_OFFSET = 4  # the first usable address follows network, router, DNS and future use
TIERS, ZONES = 3, 3
SUBNETS = TIERS * ZONES


def check(ok):
    if not ok:
        print("invariant violated", file=sys.stderr)
        sys.exit(1)


def mask_of(p):
    return 0 if p == 0 else (0xFFFFFFFF << (IPV4_BITS - p)) & 0xFFFFFFFF


def parse_ip(s):
    n = 0
    for o in s.split("."):
        n = n * OCTET_VALUES + int(o)
    return n


def fmt_ip(n):
    return ".".join(str((n >> s) & 255) for s in (24, 16, 8, 0))


def parse_cidr(text):
    ip, length = text.split("/")
    prefix = int(length)
    net = parse_ip(ip) & mask_of(prefix)  # clear the host bits
    size = 2 ** (IPV4_BITS - prefix)
    return {"net": net, "prefix": prefix, "size": size, "last": net + size - 1}


def show(c):
    return f"{fmt_ip(c['net'])}/{c['prefix']}"


# Cloud VPCs reserve 5 addresses per subnet: network, router, DNS, future use, broadcast.
def describe(text):
    c = parse_cidr(text)
    return (f"{show(c)} addresses={c['size']} usable={c['size'] - RESERVED_PER_SUBNET} first={fmt_ip(c['net'] + FIRST_HOST_OFFSET)} "
            f"last={fmt_ip(c['last'] - 1)} mask={fmt_ip(mask_of(c['prefix']))}")


# Borrow bits: n subnets need ceil(log2 n) extra prefix bits, giving 2^bits equal slots.
def split(block, count):
    bits = 0
    while 2 ** bits < count:
        bits += 1
    prefix = block["prefix"] + bits
    step = 2 ** (IPV4_BITS - prefix)
    return [{"net": block["net"] + i * step, "prefix": prefix, "size": step, "last": block["net"] + (i + 1) * step - 1}
            for i in range(2 ** bits)]


def overlaps(a, b):
    return a["net"] <= b["last"] and b["net"] <= a["last"]


# Longest-prefix match: every route whose prefix contains the address matches; the most specific wins.
def lookup(routes, ip_text):
    ip = parse_ip(ip_text)
    best = None
    for r in routes:
        c = parse_cidr(r["cidr"])
        if (ip & mask_of(c["prefix"])) == c["net"] and (best is None or c["prefix"] > best[0]):
            best = (c["prefix"], r["target"])
    return "no route (dropped)" if best is None else f"{best[1]} via /{best[0]}"


for t in ["10.0.0.0/16", "10.0.3.0/24", "192.168.1.0/28", "172.16.0.0/12"]:
    print(describe(t))
check(parse_cidr("10.0.0.0/16")["size"] == 65536)
check(parse_cidr("10.0.0.77/24")["net"] == parse_ip("10.0.0.0"))

# Three tiers x three zones = 9 subnets -> 4 bits -> 16 slots of /20, tier by tier.
slots = split(parse_cidr("10.20.0.0/16"), SUBNETS)
tiers = ["public", "private", "database"]
for i, s in enumerate(slots[:SUBNETS]):
    print(f"{tiers[i // ZONES]}-{'abc'[i % ZONES]} {show(s)} usable={s['size'] - RESERVED_PER_SUBNET}")
print(f"slots={len(slots)} free={len(slots) - SUBNETS}")
quarters = split(parse_cidr("192.168.10.0/24"), 4)
print(" ".join(show(q) for q in quarters))
check(len(slots) == 16 and slots[0]["size"] == 4096)
check(len(quarters) == 4 and all(q["size"] == 64 for q in quarters))

for a, b in [("10.20.0.0/16", "10.0.0.0/16"), ("10.0.0.0/16", "10.0.5.0/24"), ("172.20.0.0/16", "172.16.0.0/12"), ("10.0.0.0/16", "10.1.0.0/16")]:
    print(f"overlap {a} {b} {str(overlaps(parse_cidr(a), parse_cidr(b))).lower()}")
check(overlaps(parse_cidr("172.20.0.0/16"), parse_cidr("172.16.0.0/12")))
check(not overlaps(parse_cidr("10.20.0.0/16"), parse_cidr("10.0.0.0/16")))

# Order in the table does not matter: the default route is listed first on purpose.
table = [
    {"cidr": "0.0.0.0/0", "target": "nat"},
    {"cidr": "10.20.0.0/16", "target": "local"},
    {"cidr": "10.0.0.0/16", "target": "vpn"},
    {"cidr": "10.20.48.99/32", "target": "quarantine"},
]
cases = [("10.20.48.10", "local via /16"), ("10.0.0.5", "vpn via /16"), ("8.8.8.8", "nat via /0"), ("10.20.48.99", "quarantine via /32")]
for ip, want in cases:
    got = lookup(table, ip)
    print(f"{ip} -> {got}")
    if got != want:
        print(f"expected {want}", file=sys.stderr)
        sys.exit(1)
print(f"database table, 8.8.8.8 -> {lookup([{'cidr': '10.20.0.0/16', 'target': 'local'}], '8.8.8.8')}")
