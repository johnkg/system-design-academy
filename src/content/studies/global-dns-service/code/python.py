# An authoritative DNS answerer in Python:
# zone data with failover and weighted policies, health checks, a resolver cache that shows how TTL controls failover time,
# and response rate limiting (RRL) against a spoofed amplification attack.


def fnv(s):  # 32-bit FNV-1a hash
    h = 0x811C9DC5
    for c in s:
        h = ((h ^ ord(c)) * 16777619) & 0xFFFFFFFF
    return h


NEG_TTL = 60  # how long resolvers may cache "no such name" (the SOA minimum)
PRIMARY = '192.0.2.10'
ZONE = {
    'www.example.com': ('failover', [PRIMARY, '198.51.100.20'], [1, 1]),
    'cdn.example.com': ('weighted', ['203.0.113.1', '203.0.113.2', '203.0.113.3'], [70, 20, 10]),
    'mail.example.com': ('static', ['192.0.2.50'], [1]),
}


def resolve(name, client, down, ttl):
    """Answer one query from memory. `down` holds the addresses the health checkers marked unhealthy."""
    if name not in ZONE:
        return ('NXDOMAIN', [], NEG_TTL)
    kind, ips, weights = ZONE[name]
    alive = [i for i in range(len(ips)) if ips[i] not in down]
    if not alive:
        alive = list(range(len(ips)))  # everything looks down: fail open and answer anyway
    chosen = alive
    if kind == 'failover':
        chosen = [alive[0]]  # the first healthy address in priority order
    if kind == 'weighted':  # the same client always gets the same pick, so answers are stable
        total = sum(weights[i] for i in alive)
        r = fnv(f'{name}|{client}') % total
        for i in alive:
            r -= weights[i]
            if r < 0:
                chosen = [i]
                break
    return ('NOERROR', [ips[i] for i in chosen], ttl)


def failover(ttl, interval, threshold):
    """One resolver asks for www once a second. A failure starts at t=100 and health checks run every `interval` seconds."""
    fail_at, propagation, end = 100, 5, 4000
    down = set()
    consecutive, marked_at, bad, fetches, cache = 0, -1, 0, 0, None
    for t in range(end):
        if t % interval == 0:
            consecutive = consecutive + 1 if t >= fail_at else 0
            if consecutive == threshold:
                marked_at = t
        if marked_at >= 0 and t == marked_at + propagation:
            down.add(PRIMARY)  # the change reaches every name server a few seconds later
        if cache is None or t >= cache[1]:
            _, ips, answer_ttl = resolve('www.example.com', 'r1', down, ttl)
            cache = (ips[0], t + answer_ttl)
            fetches += 1
        if t >= fail_at and cache[0] == PRIMARY:
            bad += 1
    return {'marked_at': marked_at, 'bad': bad, 'fetches': fetches}


class Limiter:
    """Response rate limiting: at most `limit` full answers per second for each (client prefix, name).
    Of the excess, every second one becomes a tiny truncated reply (a real client retries over TCP), the others are dropped."""

    def __init__(self, limit):
        self.limit = limit
        self.seen = {}

    def check(self, prefix, name, sec):
        key = f'{prefix}|{name}|{sec}'
        n = self.seen.get(key, 0) + 1
        self.seen[key] = n
        if n <= self.limit:
            return 'answer'
        return 'slip' if (n - self.limit) % 2 == 0 else 'drop'


def attack(rrl):
    limiter = Limiter(5) if rrl else None
    victim = {'answer': 0, 'slip': 0, 'drop': 0}
    legit = {'answer': 0, 'slip': 0, 'drop': 0}
    for sec in range(3):
        for _ in range(1000):  # spoofed source = the victim
            victim[limiter.check('198.51.100.0/24', 'www.example.com', sec) if limiter else 'answer'] += 1
        for _ in range(2):
            legit[limiter.check('203.0.113.0/24', 'www.example.com', sec) if limiter else 'answer'] += 1
    size = victim['answer'] * 1400 + victim['slip'] * 90  # a signed answer is 1400 bytes, a truncated reply 90
    return {'victim': victim, 'legit': legit, 'bytes': size, 'amplification': f'{size / (3000 * 70):.2f}'}  # 3000 queries of 70 bytes


none = set()
for name in ['www.example.com', 'mail.example.com', 'nope.example.com']:
    rcode, ips, ttl = resolve(name, 'r1', none, 300)
    print(f"{name} -> {rcode} {','.join(ips)} ttl {ttl}")
print(f"www with the primary down -> {','.join(resolve('www.example.com', 'r1', {PRIMARY}, 300)[1])}")
print(f"everything down fails open -> {','.join(resolve('www.example.com', 'r1', set(ZONE['www.example.com'][1]), 300)[1])}")


def count(down):  # how 10,000 different clients are spread over the three addresses
    c = {}
    for i in range(10000):
        ip = resolve('cdn.example.com', f'c{i}', down, 60)[1][0]
        c[ip] = c.get(ip, 0) + 1
    return c


def show(c):
    return ' '.join(f'{ip}={c[ip]}' for ip in sorted(c))


split, split2 = count(none), count({'203.0.113.1'})
print(f'weighted 70/20/10: {show(split)}')
print(f'weighted, first one down: {show(split2)}')

results = {}
for ttl in [30, 60, 300, 3600]:
    r = failover(ttl, 10, 3)
    results[ttl] = r
    print(f"ttl {ttl}: marked down at {r['marked_at']}, users on the dead address for {r['bad']} s, {r['fetches']} queries to the name server")
off, on = attack(False), attack(True)
for label, r in [('off', off), ('on', on)]:
    v = r['victim']
    print(f"RRL {label}: victim gets {v['answer']} answers, {v['slip']} truncated, {v['drop']} dropped = {r['bytes']} bytes ({r['amplification']}x); real resolver answered {r['legit']['answer']}/6")

ok = (results[30]['marked_at'] == 120 and results[30]['bad'] == 50 and results[60]['bad'] == 80 and results[300]['bad'] == 200 and results[3600]['bad'] == 3500
      and abs(split['203.0.113.1'] - 7000) < 400 and abs(split['203.0.113.2'] - 2000) < 300 and abs(split['203.0.113.3'] - 1000) < 250 and '203.0.113.1' not in split2
      and off['victim']['answer'] == 3000 and on['victim']['answer'] == 15 and on['victim']['slip'] + on['victim']['drop'] == 2985 and on['legit']['answer'] == 6 and on['bytes'] * 20 < off['bytes'])
if not ok:
    raise SystemExit(1)
