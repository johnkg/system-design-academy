# Simplified BGP best-path selection on a tiny AS graph, with anycast, longest-prefix match and RPKI filtering.
import sys

ASN = {"T1": 100, "W": 200, "E": 300, "siteW": 64500, "siteE": 64500, "siteT": 64500,
       "c1": 11, "c2": 12, "c3": 13, "c4": 14, "evil": 666}
# [provider, customer] links and [peer, peer] links; the relation is what the neighbour is to me.
CUSTOMER_LINKS = [("T1", "W"), ("T1", "E"), ("T1", "siteT"), ("T1", "c4"), ("W", "siteW"), ("E", "siteE"),
                  ("W", "c1"), ("E", "c2"), ("W", "c3"), ("E", "c3"), ("W", "evil")]
PEER_LINKS = [("W", "E")]
NODES = list(ASN)
nbrs = {n: [] for n in NODES}
for p, c in CUSTOMER_LINKS:
    nbrs[p].append((c, "customer"))
    nbrs[c].append((p, "provider"))
for a, b in PEER_LINKS:
    nbrs[a].append((b, "peer"))
    nbrs[b].append((a, "peer"))
LOCAL_PREF = {"customer": 200, "peer": 100, "provider": 50}


def ip_to_int(s):
    v = 0
    for o in s.split("."):
        v = v * 256 + int(o)
    return v


def covers(prefix, ip):
    net, length = prefix.split("/")
    d = 2 ** (32 - int(length))
    return ip_to_int(net) // d == ip_to_int(ip) // d


def roa_ok(asn, length):
    return asn == 64500 and length <= 23  # ROA: 192.0.2.0/23, origin 64500, maxLength 23


def better(a, b):
    """Higher local-pref, then shorter AS path, then lowest neighbour AS (stand-in for router ID)."""
    if a["pref"] != b["pref"]:
        return a["pref"] > b["pref"]
    if len(a["path"]) != len(b["path"]):
        return len(a["path"]) < len(b["path"])
    return ASN[a["via"]] < ASN[b["via"]]


def propagate(origins, length, rov_nodes):
    """Propagate one prefix to a fixed point. Customer routes go to everyone, peer/provider routes only to customers."""
    best = {o: {"origin": o, "path": [], "pref": 1000, "via": None, "own": True} for o in origins}
    changed = True
    while changed:
        changed = False
        for node in NODES:
            if node in origins:
                continue
            pick = None
            for n, rel in nbrs[node]:
                r = best.get(n)
                if r is None:
                    continue
                from_customer = r["own"] or dict(nbrs[n])[r["via"]] == "customer"
                if not from_customer and rel != "provider":
                    continue  # n only exports non-customer routes to its customers
                path = [ASN[n]] + r["path"]
                if ASN[node] in path:
                    continue  # loop prevention
                if node in rov_nodes and not roa_ok(ASN[r["origin"]], length):
                    continue  # RPKI: drop invalid origin / too specific
                cand = {"origin": r["origin"], "path": path, "pref": LOCAL_PREF[rel], "via": n, "own": False}
                if pick is None or better(cand, pick):
                    pick = cand
            old = best.get(node)
            if (pick and pick["via"], pick and pick["path"]) != (old and old["via"], old and old["path"]):
                if pick:
                    best[node] = pick
                else:
                    del best[node]
                changed = True
    return best


def reach(client, dst, announcements, rov_nodes):
    """Longest-prefix match: a client uses the most specific prefix it holds a route for."""
    for a in sorted(announcements, key=lambda a: -int(a["prefix"].split("/")[1])):
        if not covers(a["prefix"], dst):
            continue
        r = propagate(a["origins"], int(a["prefix"].split("/")[1]), rov_nodes).get(client)
        if r:
            return r["origin"]
    return "none"


def check(ok, msg):
    if not ok:
        print("FAILED: " + msg)
        sys.exit(1)


DST, CLIENTS = "192.0.2.10", ["c1", "c2", "c3", "c4"]


def anycast(sites):
    return [{"prefix": "192.0.2.0/23", "origins": sites}]


def show(title, ann, rov=()):
    out = {c: reach(c, DST, ann, rov) for c in CLIENTS}
    print(f"{title}: " + " ".join(f"{c}={out[c]}" for c in CLIENTS))
    return out


full = show("3-site anycast", anycast(["siteW", "siteE", "siteT"]))
check(full["c1"] == "siteW" and full["c2"] == "siteE", "customer routes pick the local site")
check(full["c3"] == "siteW", "tie on pref and length: lowest neighbour AS wins")
check(full["c4"] == "siteT", "shortest AS path wins")
down = show("withdraw siteW", anycast(["siteE", "siteT"]))
check(down["c1"] == "siteE" and down["c3"] == "siteE", "withdrawal re-routes to the next best site")
hijack = anycast(["siteW", "siteE", "siteT"]) + [{"prefix": "192.0.2.0/24", "origins": ["evil"]}]
open_ = show("hijack /24, no ROV", hijack)
check(all(open_[c] == "evil" for c in CLIENTS), "a more specific /24 beats the /23 everywhere")
partial = show("ROV at tier-1 only", hijack, ["T1"])
check(partial["c1"] == "evil" and partial["c4"] == "siteT", "filtering only far upstream does not stop the neighbours")
filtered = show("ROV at evil ISP", hijack, ["W"])
check(all(filtered[c] == full[c] for c in CLIENTS), "filtering at the source ISP contains the hijack")
print("invariants hold")
