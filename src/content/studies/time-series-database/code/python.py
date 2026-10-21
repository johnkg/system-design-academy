# A tiny time-series database in Python:
# Gorilla compression (delta-of-delta timestamps, XOR floats) plus an inverted index from labels to series ids.
import json
import struct
import sys


def to_bits(x):
    return struct.unpack(">Q", struct.pack(">d", x))[0]


def from_bits(b):
    return struct.unpack(">d", struct.pack(">Q", b))[0]


def trailing(x):
    t = 0
    while (x >> t) & 1 == 0:
        t += 1
    return t


class BitWriter:
    def __init__(self):
        self.bits = []

    def put(self, value, n):
        for i in range(n - 1, -1, -1):
            self.bits.append((value >> i) & 1)


class BitReader:
    def __init__(self, bits):
        self.bits = bits
        self.pos = 0

    def get(self, n):
        v = 0
        for _ in range(n):
            v = (v << 1) | self.bits[self.pos]
            self.pos += 1
        return v


# A delta-of-delta fits one of three small buckets (tag, tag bits, number of bits), or falls back to 32 bits.
BUCKETS = [(0b10, 2, 7), (0b110, 3, 9), (0b1110, 4, 12)]


def bias(bits):
    return 2 ** (bits - 1) - 1


def put_dod(w, d):
    if d == 0:
        w.put(0, 1)  # a steady scrape interval costs one bit
        return
    for tag, tag_bits, bits in BUCKETS:
        if -bias(bits) <= d <= bias(bits) + 1:
            w.put(tag, tag_bits)
            w.put(d + bias(bits), bits)
            return
    w.put(0b1111, 4)
    w.put(d + 2 ** 31, 32)


def get_dod(r):
    if r.get(1) == 0:
        return 0
    k = 0
    while k < 3 and r.get(1) == 1:
        k += 1
    if k == 3:
        return r.get(32) - 2 ** 31
    return r.get(BUCKETS[k][2]) - bias(BUCKETS[k][2])


def compress(points):
    w = BitWriter()
    w.put(points[0][0], 32)
    w.put(to_bits(points[0][1]), 64)
    prev_t, prev_delta, prev, lead, length = points[0][0], 0, to_bits(points[0][1]), -1, 0
    for t, v in points[1:]:
        put_dod(w, t - prev_t - prev_delta)
        prev_delta = t - prev_t
        prev_t = t
        bits = to_bits(v)
        x = bits ^ prev
        prev = bits
        if x == 0:
            w.put(0, 1)  # same value as before: one bit
            continue
        l, tz = min(64 - x.bit_length(), 31), trailing(x)
        if lead >= 0 and l >= lead and tz >= 64 - lead - length:  # fits the previous window
            w.put(0b10, 2)
            w.put(x >> (64 - lead - length), length)
        else:
            m = 64 - l - tz
            w.put(0b11, 2)
            w.put(l, 5)
            w.put(m - 1, 6)
            w.put(x >> tz, m)
            lead, length = l, m
    return w.bits


def decompress(bits, n):
    r = BitReader(bits)
    t, prev, delta, lead, length = r.get(32), r.get(64), 0, 0, 0
    out = [[t, from_bits(prev)]]
    while len(out) < n:
        delta += get_dod(r)
        t += delta
        if r.get(1) == 1:
            if r.get(1) == 1:
                lead, length = r.get(5), r.get(6) + 1
            prev ^= r.get(length) << (64 - lead - length)
        out.append([t, from_bits(prev)])
    return out


# The inverted index: "label=value" -> sorted list of series ids. A query intersects the lists.
series, postings, blocks = [], {}, []


def add_series(labels, points):
    sid = len(series)
    series.append(labels)
    for k, v in labels.items():
        postings.setdefault(f"{k}={v}", []).append(sid)
    blocks.append((len(points), compress(points)))


def intersect(a, b):
    out, i, j = [], 0, 0
    while i < len(a) and j < len(b):
        if a[i] == b[j]:
            out.append(a[i])
            i += 1
            j += 1
        elif a[i] < b[j]:
            i += 1
        else:
            j += 1
    return out


def select(matchers):
    lists = sorted((postings.get(m, []) for m in matchers), key=len)
    result = lists[0]
    for lst in lists[1:]:
        result = intersect(result, lst)
    return result


SERIES = 8  # hosts h0..h7
POINTS = 120  # points per series
BASE_VALUE = 50.0  # host h starts at 50 + h
VALUE_STEP = 0.25  # a changing scrape moves the value by one step
SCRAPE_S = 10  # seconds between scrapes
JITTER_ONE_IN = 8  # one scrape in 8 lands a second late
WEB_HOSTS = 5  # h0..h4 are web, the rest db
QUERY_FROM = 300  # the range query covers T0+300 .. T0+599
QUERY_TO = 600
MAX_BITS_PER_POINT = 40  # compression must do better than this


seed = 7


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


T0, raw = 1700000000, []
for h in range(SERIES):
    v, points = BASE_VALUE + h, []
    for i in range(POINTS):
        if random(2) == 0:
            v += (random(3) - 1) * VALUE_STEP  # half the scrapes see no change
        points.append([T0 + i * SCRAPE_S + (1 if random(JITTER_ONE_IN) == 0 else 0), v])
    raw.append(points)
    add_series({"__name__": "cpu", "host": f"h{h}", "region": "eu" if h % 2 == 0 else "us", "tier": "web" if h < WEB_HOSTS else "db"}, points)

total, count = sum(len(b[1]) for b in blocks), len(raw) * POINTS
print(f"{len(series)} series, {count} points, raw {count * 16} bytes")
print(f"compressed {sum((len(b[1]) + 7) // 8 for b in blocks)} bytes, {total / count:.2f} bits per point")
ok = all(json.dumps(decompress(b[1], b[0])) == json.dumps(raw[i]) for i, b in enumerate(blocks))
print(f"round trip exact: {str(ok).lower()}")

ids = select(["__name__=cpu", "region=eu", "tier=web"])
print(f"region=eu has [{','.join(map(str, postings['region=eu']))}]; cpu, eu and web match series [{','.join(map(str, ids))}]")
total_sum, hits = 0.0, 0
for sid in ids:
    for t, v in decompress(blocks[sid][1], blocks[sid][0]):
        if T0 + QUERY_FROM <= t < T0 + QUERY_TO:
            total_sum += v
            hits += 1
print(f"points in the range: {hits}, sum {total_sum:.2f}")
if not ok or ids != [0, 2, 4] or total / count > MAX_BITS_PER_POINT:
    sys.exit(1)
