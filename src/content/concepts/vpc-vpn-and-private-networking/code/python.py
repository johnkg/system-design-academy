# A toy VPC routing evaluator: "can A reach B?" by longest-prefix route lookup, plus the checks that make a route usable.
# Topology: VPC A 10.0.0.0/16 with a public subnet (web, public IP), a private subnet (app) and a database subnet (db).
# A NAT gateway sits in the public subnet. A peer VPC B, an on-premises network 192.168.0.0/16 (over a VPN) and the internet are outside.
# Assumptions: security groups and ACLs allow everything, so only routing is judged; the VPN's far side routes replies back;
# peering needs non-overlapping CIDRs and a route on BOTH sides; an internet gateway only serves hosts with a public IP.


def ipv(s):
    acc = 0
    for o in s.split("."):
        acc = acc * 256 + int(o)
    return acc


def parse(cidr):
    b, n = cidr.split("/")
    bits = int(n)
    return ipv(b), bits, 2 ** (32 - bits)


def contains(cidr, ip):
    base, _, size = parse(cidr)
    a = ipv(ip)
    return base <= a < base + size


def overlaps(x, y):
    ab, _, asz = parse(x)
    bb, _, bsz = parse(y)
    return ab < bb + bsz and bb < ab + asz


def is_private(ip):
    return contains("10.0.0.0/8", ip) or contains("172.16.0.0/12", ip) or contains("192.168.0.0/16", ip)


# Longest prefix wins; on a tie the earlier entry (the local route) wins.
def lookup(table, ip):
    best = None
    for cidr, target in table:
        bits = parse(cidr)[1]
        if contains(cidr, ip) and (best is None or bits > best[0]):
            best = (bits, target)
    return None if best is None else best[1]


VPC = "10.0.0.0/16"
HOSTS = {"web": "10.0.1.10", "app": "10.0.2.10", "db": "10.0.3.10"}


def build_tables(c):
    extra = []
    if c["vpn"]:
        extra.append(("192.168.0.0/16", "vpn"))
    if c["peerRoute"]:
        extra.append((c["peerCidr"], "peering"))
    pub = [(VPC, "local"), ("0.0.0.0/0", "igw")] + extra
    priv = [(VPC, "local")] + ([("0.0.0.0/0", "nat")] if c["nat"] else []) + extra
    db = [(VPC, "local")] + ([("0.0.0.0/0", "igw")] if c["dbOpen"] else [])
    return {"web": pub, "app": priv, "db": db}


def reach(c, tables, src, dest):
    target = lookup(tables[src], dest)
    has_public_ip = src == "web" or (src == "db" and c["dbOpen"])
    if target is None:
        return "no route"
    if target == "local":
        return "ok (local)" if dest in HOSTS.values() else "no such host here"
    if target == "igw":
        if not has_public_ip:
            return "no public IP"
        return "private address dropped" if is_private(dest) else "ok (internet gateway)"
    if target == "nat":
        return "private address dropped" if is_private(dest) else "ok (NAT gateway)"
    if target == "peering":
        if overlaps(VPC, c["peerCidr"]):
            return "peering impossible (overlap)"
        return "ok (peering)" if c["peerBack"] else "reply has no route back"
    return "ok (VPN)"


def evaluate(name, c):
    tables = build_tables(c)
    octets = c["peerCidr"].split("/")[0].split(".")
    peer_host = f"{octets[0]}.{octets[1]}.{octets[2]}.10"  # a host at .10 in the peer VPC's first subnet
    dests = [("internet", "8.8.8.8"), ("peer", peer_host), ("onprem", "192.168.5.5"), ("db", HOSTS["db"])]
    ok = 0
    print(f"{name}:")
    for src in ["web", "app", "db"]:
        cells = []
        for label, ip in dests:
            r = "-" if src == "db" and label == "db" else reach(c, tables, src, ip)
            if r.startswith("ok"):
                ok += 1
            cells.append(f"{label}={r}")
        print(f"  {src} -> {', '.join(cells)}")
    in_web = "reachable" if lookup(tables["web"], "203.0.113.9") == "igw" else "no path"
    in_db = "reachable" if c["dbOpen"] and lookup(tables["db"], "203.0.113.9") == "igw" else "no path"
    print(f"  internet -> web: {in_web}, internet -> db: {in_db}; working paths: {ok}")


BASE = {"nat": True, "vpn": False, "peerRoute": False, "peerBack": False, "peerCidr": "10.1.0.0/16", "dbOpen": False}
evaluate("baseline", BASE)
evaluate("no NAT route in the private subnet", {**BASE, "nat": False})
evaluate("peering, route on one side only", {**BASE, "peerRoute": True})
evaluate("peering, routes on both sides", {**BASE, "peerRoute": True, "peerBack": True})
evaluate("peering, overlapping CIDRs", {**BASE, "peerRoute": True, "peerBack": True, "peerCidr": "10.0.0.0/16"})
evaluate("VPN route added", {**BASE, "vpn": True})
evaluate("database subnet with a default route and public IP", {**BASE, "dbOpen": True})
