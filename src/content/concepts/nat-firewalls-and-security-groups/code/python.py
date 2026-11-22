# A toy packet filter and a toy source-NAT table.
# Part 1: a stateless ACL (ordered rules, first match wins, replies need their own rule)
#         against a stateful security group (allow rules only, replies ride the connection table).
# Part 2: source NAT: how a reply finds its way back, and what happens when the port pool runs out.
# Assumptions: IPv4, TCP only. The guarded server listens on 443, 22 and 5432. "Outside" means outside 10.0.0.0/8.
# A public address has at most about 64,000 ports (1024 to 65535) per destination; products set their own limits (an AWS NAT gateway
# allows up to 55,000 simultaneous connections per address to each unique destination). The pool here is tiny so the effect is visible.


def ipv(s):
    acc = 0
    for o in s.split("."):
        acc = acc * 256 + int(o)
    return acc


def in_cidr(addr, cidr):
    base, bits = cidr.split("/")
    size = 2 ** (32 - int(bits))
    b = ipv(base)
    return b <= addr < b + size


# rule = (action, cidr, first_port, last_port); the cidr matches the peer address, the ports match the local port
def evaluate(rules, peer, port):
    for action, cidr, lo, hi in rules:
        if in_cidr(ipv(peer), cidr) and lo <= port <= hi:
            return action == "allow"
    return False  # default deny


LISTENING = [443, 22, 5432]
EPHEMERAL = 50000  # the client's source port; a reply goes back to it
ATTEMPTS = [
    ("203.0.113.5", 443), ("198.51.100.7", 443), ("203.0.113.5", 22),
    ("10.0.1.9", 5432), ("203.0.113.9", 5432), ("192.0.2.44", 80),
]
ANY = "0.0.0.0/0"
RETURN = ("allow", ANY, 1024, 65535)
CONFIGS = [
    ("stateless ACL, inbound rules only", False, [("allow", ANY, 443, 443), ("allow", "10.0.0.0/16", 5432, 5432)], []),
    ("stateless ACL, with return rule", False, [("allow", ANY, 443, 443), ("allow", "10.0.0.0/16", 5432, 5432)], [RETURN]),
    ("stateful group, same allow rules", True, [("allow", ANY, 443, 443), ("allow", "10.0.0.0/16", 5432, 5432)], []),
    ("ACL, deny /24 listed first", False, [("deny", "203.0.113.0/24", 0, 65535), ("allow", ANY, 443, 443), ("allow", "10.0.0.0/16", 5432, 5432)], [RETURN]),
    ("ACL, deny /24 listed second", False, [("allow", ANY, 443, 443), ("deny", "203.0.113.0/24", 0, 65535), ("allow", "10.0.0.0/16", 5432, 5432)], [RETURN]),
    ("stateful group, allow all to test", True, [("allow", ANY, 0, 65535)], []),
]

for name, stateful, in_rules, out_rules in CONFIGS:
    works = 0
    reached = 0
    exposed = []
    for client, port in ATTEMPTS:
        request = evaluate(in_rules, client, port)
        reply = request if stateful else evaluate(out_rules, client, EPHEMERAL)
        if request:
            reached += 1
        if request and reply and port in LISTENING:
            works += 1
            if not client.startswith("10.") and port != 443:
                exposed.append(port)
    shown = "none" if len(exposed) == 0 else ",".join(str(p) for p in exposed)
    print(f"{name}: requests that reach the server={reached} connections that work={works} internet-reachable admin ports={shown}")

# Part 2: source NAT. Each outbound connection gets a public port; the reply is matched against that table.
PUBLIC_IP = "198.51.100.1"
entries = []  # (public_port, "private_ip:port")
for priv, port in [("10.0.2.10", 40001), ("10.0.2.11", 40001), ("10.0.2.10", 40002)]:
    pub = 1024 + len(entries)
    entries.append((pub, f"{priv}:{port}"))
    print(f"SNAT {priv}:{port} -> {PUBLIC_IP}:{pub}")
for p in [1025, 9999]:
    row = next((e for e in entries if e[0] == p), None)
    print(f"reply to {PUBLIC_IP}:{p} -> {row[1]}" if row else f"unsolicited packet to {PUBLIC_IP}:{p} -> dropped (no table entry)")


# Tick model of the port pool: `rate` new connections per tick, each holding its port for `hold` ticks.
def nat_run(pool, rate, hold, ticks):
    expiring = [0] * (ticks + hold + 1)
    used = allocated = dropped = peak = 0
    for t in range(ticks):
        used -= expiring[t]
        got = min(rate, pool - used)
        used += got
        allocated += got
        dropped += rate - got
        expiring[t + hold] += got
        peak = max(peak, used)
    return f"pool={pool} rate={rate}/tick hold={hold} ticks: allocated={allocated} dropped={dropped} peak in use={peak}"


print(nat_run(20, 4, 3, 30))
print(nat_run(20, 4, 6, 30))
print(nat_run(40, 4, 6, 30))
