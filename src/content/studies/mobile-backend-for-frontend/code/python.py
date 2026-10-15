# A mobile backend-for-frontend (BFF) in Python:
# one home-screen request fans out to five services in parallel, each with its own timeout,
# optional parts may be missing (a partial response), the body is shaped to what the app version needs, and an ETag lets the app skip an unchanged body.
import sys

# since: the first app version that shows this part. required: without it there is no screen. timeout in ms.
SERVICES = [
    {'name': 'profile', 'required': True, 'since': 1, 'timeout': 120, 'base': 30, 'spread': 40},
    {'name': 'orders', 'required': True, 'since': 1, 'timeout': 150, 'base': 40, 'spread': 60},
    {'name': 'recs', 'required': False, 'since': 1, 'timeout': 100, 'base': 40, 'spread': 120},
    {'name': 'promos', 'required': False, 'since': 3, 'timeout': 80, 'base': 20, 'spread': 100},
    {'name': 'inbox', 'required': False, 'since': 1, 'timeout': 80, 'base': 15, 'spread': 30},
]
RAW_EXTRA = 300  # bytes each service returns that this screen never shows

seed = 7


def rnd(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


def latency(s):
    l = s['base'] + rnd(s['spread'])
    return 2000 if rnd(100) < 3 else l  # 3% of calls hang


# FNV-1a, 32 bits: a cheap stand-in for the hash behind an ETag.
def etag_of(text):
    h = 2166136261
    for ch in text:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return format(h, '08x')


def handle(user, version):
    plan = [s for s in SERVICES if s['since'] <= version]  # an old app never triggers a call it cannot show
    calls = [(s, latency(s)) for s in plan]
    waits = [min(ms, s['timeout']) for s, ms in calls]      # each call is cut off at its own timeout
    parts, degraded = [], []
    raw_bytes, failed_required = 0, False
    for s, ms in calls:
        if ms <= s['timeout']:
            parts.append(f"{s['name']}={(user * 7 + len(s['name'])) % 100}")
            raw_bytes += RAW_EXTRA + 12
        elif s['required']:
            failed_required = True
        else:
            degraded.append(s['name'])
    body = ';'.join(parts)
    return {'status': 503 if failed_required else 200, 'body': body, 'degraded': degraded, 'raw': raw_bytes,
            'parallel': max(waits), 'sequential': sum(waits), 'etag': etag_of(body)}


N = 200
last = {}
times, seq = [], []
ok = partial = errors = not_modified = shaped = wire = raw = 0
for i in range(N):
    user, version = i % 20, 3 if i % 2 == 0 else 2
    r = handle(user, version)
    times.append(r['parallel'])
    seq.append(r['sequential'])
    if r['status'] != 200:
        errors += 1
        continue
    ok += 1
    if r['degraded']:
        partial += 1
    shaped += len(r['body'])
    raw += r['raw']
    if last.get(user) == r['etag']:  # the app sent If-None-Match, so the reply is 304 with no body
        not_modified += 1
    else:
        wire += len(r['body'])
    last[user] = r['etag']
times.sort()


def mean(a):
    return sum(a) // len(a)


p95 = times[N * 95 // 100]
print(f"requests {N}: {ok} ok ({partial} partial), {errors} failed")
print(f"parallel mean {mean(times)} ms, p95 {p95} ms; one after another would average {mean(seq)} ms")
print(f"not modified {not_modified}; bytes: {raw} from the services, {shaped} after shaping, {wire} on the wire")
print(f"ETag of 'a=1': {etag_of('a=1')}")
if p95 > 150 or mean(seq) <= mean(times) or shaped >= raw or wire >= shaped or ok + errors != N or not_modified == 0:
    sys.exit(1)
