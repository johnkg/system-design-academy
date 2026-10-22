# A small VPN gateway fleet, in Python: pick a gateway by latency plus load, keep a session alive across address changes,
# detect a dead peer, drain a gateway without dropping its users, and split traffic by route.
MASK = 0xFFFFFFFF

def fnv(*xs):
    h = 0x811C9DC5
    for x in xs:
        h = ((h ^ x) & MASK) * 16777619 & MASK
    return h

SEED, CLIENTS, REGIONS = 7, 24, 3
LOAD_PENALTY_MS = 60  # a full gateway counts as 60 ms further away
KEY_SALT, ADDR_BASE = 99, 1000  # per-session key derivation; tunnel addresses start at 1000
DEAD_AFTER = 30  # ticks of silence before a peer is dead
IPV4_BITS = 32
seed = SEED

def rnd(n):
    global seed
    seed = (seed * 1664525 + 1013904223) & MASK
    return (seed >> 8) % n

LAT = [[10, 60, 120], [60, 10, 90], [120, 90, 10], [30, 40, 100]]  # ms from each region to each gateway
CAP = 8
gateways = [{'id': i, 'lat': lat, 'draining': False, 'sessions': {}} for i, lat in enumerate(LAT)]

# Cost = round-trip time plus a penalty that grows with load; full or draining gateways are not candidates.
def pick(region):
    best, best_cost = None, 10**9
    for g in gateways:
        if g['draining'] or len(g['sessions']) >= CAP:
            continue
        cost = g['lat'][region] + len(g['sessions']) * LOAD_PENALTY_MS // CAP
        if cost < best_cost:
            best, best_cost = g, cost
    return best

def connect(sid, region):
    g = pick(region)
    s = {'sid': sid, 'key': fnv(sid, KEY_SALT), 'region': region, 'addr': ADDR_BASE + sid, 'last_seq': 0, 'last_seen': 0, 'gw': g['id']}
    g['sessions'][sid] = s
    return s

# A packet carries session id, sequence number and a tag. The source address is NOT part of the identity, so a client can roam.
def packet(s, seq, addr):
    return {'sid': s['sid'], 'seq': seq, 'addr': addr, 'tag': fnv(s['key'], s['sid'], seq)}

def receive(g, pkt, now):
    s = g['sessions'].get(pkt['sid'])
    if s is None:
        return 'unknown session'
    if pkt['tag'] != fnv(s['key'], pkt['sid'], pkt['seq']):
        return 'bad tag'
    if pkt['seq'] <= s['last_seq']:
        return 'replay'
    roamed = pkt['addr'] != s['addr']
    s['addr'], s['last_seq'], s['last_seen'] = pkt['addr'], pkt['seq'], now
    return 'ok, roamed' if roamed else 'ok'

# Dead-peer detection: a keepalive every 10 ticks, and a peer is dead after 3 missed keepalives.
def dead_peers(g, now):
    return [s['sid'] for s in g['sessions'].values() if now - s['last_seen'] >= DEAD_AFTER]

# Drain: stop accepting, then resume every session elsewhere with the same key and sequence number.
def drain(g):
    g['draining'] = True
    moved = 0
    for s in list(g['sessions'].values()):
        to = pick(s['region'])
        del g['sessions'][s['sid']]
        s['gw'] = to['id']
        to['sessions'][s['sid']] = s
        moved += 1
    return moved

def ip(a, b, c, d):
    return ((a << 24) | (b << 16) | (c << 8) | d) & MASK

def in_net(addr, net, bits):
    return (addr >> (IPV4_BITS - bits)) == (net >> (IPV4_BITS - bits))

def via_tunnel(addr):
    return in_net(addr, ip(10, 0, 0, 0), 8) or in_net(addr, ip(192, 168, 0, 0), 16)

regions = [rnd(REGIONS) for _ in range(CLIENTS)]
nearest = [0] * len(LAT)
for r in regions:
    col = [l[r] for l in LAT]
    nearest[col.index(min(col))] += 1
sessions = [connect(i + 1, r) for i, r in enumerate(regions)]

def loads():
    return ','.join(str(len(g['sessions'])) for g in gateways)

def avg():
    return sum(gateways[s['gw']]['lat'][s['region']] for s in sessions) // len(sessions)

print('nearest only:', ','.join(map(str, nearest)), '| latency and load:', loads(), '| avg ms:', avg())
assert all(len(g['sessions']) <= CAP for g in gateways)

s1 = sessions[0]
g1 = gateways[s1['gw']]
print('seq 1 from home:', receive(g1, packet(s1, 1, s1['addr']), 5))
print('seq 2 from new network:', receive(g1, packet(s1, 2, 7000), 10))
print('seq 2 again:', receive(g1, packet(s1, 2, 8000), 11))
print('forged tag:', receive(g1, dict(packet(s1, 3, 9000), tag=1), 12))
print('silent since tick 10, dead at 39:', 'true' if s1['sid'] in dead_peers(g1, 39) else 'false',
      '| at 40:', 'true' if s1['sid'] in dead_peers(g1, 40) else 'false')

busiest = gateways[0]
for g in gateways:
    if len(g['sessions']) > len(busiest['sessions']):
        busiest = g
before = len(busiest['sessions'])
print('drain gateway', busiest['id'], 'moved', drain(busiest), 'of', before, '| loads:', loads())
assert len(busiest['sessions']) == 0 and sum(len(g['sessions']) for g in gateways) == CLIENTS
print('session kept its sequence:', receive(gateways[s1['gw']], packet(s1, 3, 7100), 20))
print('split tunnel:', ','.join('tunnel' if via_tunnel(a) else 'direct' for a in [ip(10, 4, 1, 9), ip(192, 168, 7, 1), ip(142, 250, 1, 1)]))
