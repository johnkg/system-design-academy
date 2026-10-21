# A tiny OLAP engine in Python: events are rolled up into time-partitioned segments,
# each segment stores dictionary-encoded columns with bitmap indexes, and a query is
# scattered over the segments that can match and the partial sums are merged.

seed = 7


def rnd(n):
    global seed
    seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
    return (seed >> 16) % n


COUNTRIES = ['US', 'DE', 'FR', 'JP', 'BR', 'IN']
DEVICES = ['ios', 'web', 'android']
WINDOW, BUCKET = 60, 10  # a segment covers 60 minutes, rollup granularity is 10 minutes
EVENTS = 6000
MINUTES = 240  # events fall in the first 4 hours
MAX_MS = 500  # latency 1..500 ms
KEY_STEP = 100  # rollup key = bucket * KEY_STEP^2 + country * KEY_STEP + device
KEY_BUCKET = KEY_STEP * KEY_STEP
QUERY_FROM = 60  # the demo query covers minutes 60..179
QUERY_TO = 180
events = []
for _ in range(EVENTS):
    t = rnd(MINUTES)
    c = min(rnd(len(COUNTRIES)), rnd(len(COUNTRIES)))  # countries are skewed
    d = rnd(len(DEVICES))
    ms = 1 + rnd(MAX_MS)
    events.append((t, c, d, ms))


def encode(values):
    """Dictionary encoding: sorted distinct values get small ids; a bitmap per id marks the rows holding it."""
    dictionary = sorted(set(values))
    bitmaps = [[0] * ((len(values) + 15) >> 4) for _ in dictionary]
    for row, v in enumerate(values):
        bitmaps[dictionary.index(v)][row >> 4] |= 1 << (row & 15)
    return dictionary, bitmaps


def build_segment(start, evs):
    acc = {}  # rollup: one row per (bucket, country, device) with a count and a sum
    for t, c, d, ms in evs:
        key = (t // BUCKET) * KEY_BUCKET + c * KEY_STEP + d
        a = acc.setdefault(key, [0, 0])
        a[0] += 1
        a[1] += ms
    rows = [(k // KEY_BUCKET * BUCKET, COUNTRIES[k // KEY_STEP % KEY_STEP], DEVICES[k % KEY_STEP], acc[k][0], acc[k][1]) for k in sorted(acc)]
    return {'start': start, 'end': start + WINDOW, 'rows': rows,
            'country': encode([r[1] for r in rows]), 'device': encode([r[2] for r in rows])}


segments = [build_segment(s, [e for e in events if s <= e[0] < s + WINDOW]) for s in range(0, MINUTES, WINDOW)]
print(f"raw events: {len(events)}, rolled-up rows: {sum(len(s['rows']) for s in segments)} in {len(segments)} segments ({', '.join(str(len(s['rows'])) for s in segments)})")
print(f"segment 1 country dictionary: {','.join(segments[1]['country'][0])}")


def or_bitmaps(col, names):
    """OR the bitmaps of every wanted value that this segment knows."""
    dictionary, bitmaps = col
    out = [0] * len(bitmaps[0])
    for n in names:
        if n in dictionary:
            for i, w in enumerate(bitmaps[dictionary.index(n)]):
                out[i] |= w
    return out


def scan_segment(seg, lo, hi, countries, device):
    """One segment's share of the work: filter with bitmaps, then aggregate only the matching rows."""
    a, b = or_bitmaps(seg['country'], countries), or_bitmaps(seg['device'], [device])
    hit = [x & y for x, y in zip(a, b)]
    part, matched = {}, 0
    for row, (bucket, _, _, count, total) in enumerate(seg['rows']):
        if not (hit[row >> 4] >> (row & 15)) & 1 or bucket < lo or bucket >= hi:
            continue
        p = part.setdefault(bucket, [0, 0])
        p[0] += count
        p[1] += total
        matched += 1
    return part, matched


def query(lo, hi, countries, device):
    """Scatter to segments that overlap the time range, then gather."""
    merged, scanned, matched = {}, 0, 0
    for seg in segments:
        if seg['end'] <= lo or seg['start'] >= hi:
            continue  # pruned by time range
        scanned += 1
        part, m = scan_segment(seg, lo, hi, countries, device)
        matched += m
        for b, (c, s) in part.items():
            a = merged.setdefault(b, [0, 0])
            a[0] += c
            a[1] += s
    return merged, scanned, matched


merged, scanned, matched = query(QUERY_FROM, QUERY_TO, ['DE', 'FR'], 'ios')
for b in sorted(merged):
    print(f"minute {b}: {merged[b][0]} events, avg {merged[b][1] // merged[b][0]} ms")
print(f"segments scanned: {scanned} of {len(segments)}, rolled rows matched: {matched}")

# The rolled-up answer must equal a brute-force pass over the raw events.
raw = {}
for t, c, d, ms in events:
    if t < QUERY_FROM or t >= QUERY_TO or d != 0 or c not in (1, 2):
        continue
    a = raw.setdefault(t // BUCKET * BUCKET, [0, 0])
    a[0] += 1
    a[1] += ms
same = raw == merged
print(f"matches brute force over raw events: {str(same).lower()}")
if not same or scanned != 2:
    raise SystemExit(1)
