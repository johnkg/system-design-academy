# An erasure-coded object store in miniature, in Python:
# a Reed-Solomon code (4 data + 2 parity shards) over GF(256), shards placed on racks, disks and racks failing, and repair.
import math
import sys

K, M = 4, 2
N = K + M  # any K of the N shards rebuild the object
RACKS, DISKS, OBJECTS, ROUNDS, P_DISK, P_RACK = N, 8, 200, 20, 0.02, 0.03
OBJECT_BYTES = 64
SHARD_BYTES = OBJECT_BYTES // K
PLACE_SEED, FAIL_SEED = 7, 99
P_LOSS, PER_BILLION = 0.01, 1e9  # durability maths: each disk lost with probability 1%
# GF(256): 256 elements, a multiplicative group of order 255, generated modulo x^8 + x^4 + x^3 + x^2 + 1.
GF_SIZE, GF_POLY = 256, 0x11d
GF_ORDER = GF_SIZE - 1

# Arithmetic in GF(256): addition is XOR, multiplication goes through log and antilog tables.
EXP = [0] * (2 * GF_SIZE)
LOG = [0] * GF_SIZE
x = 1
for i in range(GF_ORDER):
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if x & GF_SIZE:
        x ^= GF_POLY
for i in range(GF_ORDER, 2 * GF_SIZE):
    EXP[i] = EXP[i - GF_ORDER]


def mul(a, b):
    return EXP[LOG[a] + LOG[b]] if a and b else 0


def inv(a):
    return EXP[GF_ORDER - LOG[a]]


# Row s of the coding matrix: shards 0..K-1 are the data itself, the rest are Cauchy rows, so any K rows can be inverted.
def row(s):
    return [int(s == j) if s < K else inv(s ^ j) for j in range(K)]


def encode(data):  # data is split in K pieces, and N shards come out
    length = len(data) // K
    shards = []
    for s in range(N):
        coeffs = row(s)
        shard = bytearray(length)
        for t in range(length):
            acc = 0
            for j, c in enumerate(coeffs):
                acc ^= mul(c, data[j * length + t])
            shard[t] = acc
        shards.append(bytes(shard))
    return shards


def invert(a):  # Gauss-Jordan elimination in GF(256)
    m = [list(r) + [int(i == j) for j in range(K)] for i, r in enumerate(a)]
    for c in range(K):
        p = c
        while m[p][c] == 0:
            p += 1
        m[c], m[p] = m[p], m[c]
        iv = inv(m[c][c])
        m[c] = [mul(v, iv) for v in m[c]]
        for r in range(K):
            if r != c and m[r][c]:
                f = m[r][c]
                m[r] = [v ^ mul(f, m[c][j]) for j, v in enumerate(m[r])]
    return [r[K:] for r in m]


def decode(shards):  # shards has None where a shard is gone; needs at least K of them
    have = [i for i, s in enumerate(shards) if s is not None][:K]
    if len(have) < K:
        return None
    back = invert([row(s) for s in have])
    length = len(shards[have[0]])
    out = bytearray(K * length)
    for j in range(K):
        for t in range(length):
            acc = 0
            for i, s in enumerate(have):
                acc ^= mul(back[j][i], shards[s][t])
            out[j * length + t] = acc
    return bytes(out)


def mulberry32(a):
    def next_value():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = ((a ^ (a >> 15)) * (1 | a)) & 0xFFFFFFFF
        t = ((t + (((t ^ (t >> 7)) * (61 | t)) & 0xFFFFFFFF)) & 0xFFFFFFFF) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return next_value


def simulate(spread):  # spread: one shard per rack; otherwise all shards in one rack
    place, fail = mulberry32(PLACE_SEED), mulberry32(FAIL_SEED)  # separate streams, so both layouts face the same failures

    def ri(n):
        return math.floor(place() * n)

    def pick(rack, used):
        d = rack * DISKS + ri(DISKS)
        while d in used:
            d = rack * DISKS + ri(DISKS)
        return d

    objects = []
    for _ in range(OBJECTS):
        data = bytes(ri(GF_SIZE) for _ in range(OBJECT_BYTES))
        home = ri(RACKS)
        used, loc = set(), []
        for s in range(N):
            d = pick(s if spread else home, used)
            used.add(d)
            loc.append(d)
        objects.append({'data': data, 'shards': encode(data), 'loc': loc, 'lost': False})
    st = {'lost': 0, 'rebuilt': 0, 'read': 0, 'wrote': 0}
    for _ in range(ROUNDS):
        dead = set()
        for rack in range(RACKS):
            if fail() < P_RACK:
                dead.update(rack * DISKS + d for d in range(DISKS))
        for d in range(RACKS * DISKS):
            if fail() < P_DISK:
                dead.add(d)
        for o in objects:
            if o['lost']:
                continue
            for s, d in enumerate(o['loc']):
                if d in dead:
                    o['shards'][s] = None
            missing = [i for i, s in enumerate(o['shards']) if s is None]
            if not missing:
                continue
            data = decode(o['shards'])
            if data is None:
                o['lost'] = True
                st['lost'] += 1
                continue
            fresh = encode(data)
            used = set(o['loc'])
            for s in missing:
                d = pick(o['loc'][s] // DISKS, used)
                used.add(d)
                o['loc'][s] = d
                o['shards'][s] = fresh[s]
                st['wrote'] += SHARD_BYTES
                st['rebuilt'] += 1
            st['read'] += K * SHARD_BYTES  # one decode reads K shards of 16 bytes, however many shards are rebuilt
    for o in objects:
        if not o['lost'] and decode(o['shards']) != o['data']:
            raise RuntimeError('corrupt object')
    return st


# Chance that an object is lost when each shard is lost with probability p before repair: more than tol shards gone.
def loss(n, tol, p):
    total, c = 0, 1
    for i in range(n + 1):
        if i > 0:
            c = (c * (n - i + 1)) / i
        t = c
        for _ in range(i):
            t *= p
        for _ in range(n - i):
            t *= 1 - p
        if i > tol:
            total += t
    return total


def per_billion(v):
    return math.floor(v * PER_BILLION + 0.5)


# 1. Every pattern of up to M missing shards decodes; M+1 missing shards never do.
sample = bytes((i * 37 + 11) & 255 for i in range(OBJECT_BYTES))
whole = encode(sample)
ok = fine = dead = too_many = 0
for mask in range(1 << N):
    gone = bin(mask).count('1')
    if gone > M + 1:
        continue
    out = decode([None if (mask >> i) & 1 else s for i, s in enumerate(whole)])
    if gone <= M:
        fine += 1
        if out is not None and out == sample:
            ok += 1
    else:
        too_many += 1
        if out is None:
            dead += 1
print(f"{K}+{M} code: {ok} of {fine} patterns with up to {M} lost shards decode correctly; {dead} of {too_many} with {M + 1} lost cannot")
print(f"storage overhead {N / K:.2f}x, against 3.00x for three copies")

# 2. Racks and disks fail for 20 rounds, and repair runs after every round.
for spread in [True, False]:
    s = simulate(spread)
    label = 'one shard per rack  ' if spread else 'all shards in a rack'
    print(f"{label}: lost {s['lost']} of {OBJECTS} objects, rebuilt {s['rebuilt']} shards, read {s['read']} bytes and wrote {s['wrote']} bytes")

# 3. The same durability maths for three layouts when each disk is lost with probability 1%.
layouts = [('3 copies', 3, 2), ('4+2', 6, 2), ('10+4', 14, 4)]
for name, n, tol in layouts:
    print(f"{name.ljust(8)} loses {per_billion(loss(n, tol, P_LOSS))} objects per billion")
if ok != fine or dead != too_many or simulate(True)['lost'] >= simulate(False)['lost']:
    sys.exit(1)
