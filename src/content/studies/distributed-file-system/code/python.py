# A tiny GFS-style cluster in Python: a master with a chunk map, rack-aware placement,
# heartbeats that detect dead servers, prioritised re-replication, and checksum scrubbing.
RACKS, PER, CHUNKS, BLOCKS, COPY_BUDGET, TIMEOUT = 6, 3, 40, 4, 4, 3
N = RACKS * PER
seed = 7

def rnd(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n

def mix(x):
    x = ((x ^ (x >> 16)) * 0x45D9F3B) & 0xFFFFFFFF
    x = ((x ^ (x >> 16)) * 0x45D9F3B) & 0xFFFFFFFF
    return (x ^ (x >> 16)) & 0xFFFFFFFF

rack = lambda n: n // PER

# Chunkservers: each holds chunk id -> {data (block values), sums (checksum per block)}.
store = [{} for _ in range(N)]
alive = [True] * N
last_beat = [0] * N
declared_dead = [False] * N
replicas = [[] for _ in range(CHUNKS)]  # the master's chunk map: chunk -> server list

def pick_node(ok):
    while True:
        n = rnd(N)
        if alive[n] and not declared_dead[n] and ok(n):
            return n

def write_replica(c, n, data):
    store[n][c] = {"data": list(data), "sums": [mix(v) for v in data]}
    replicas[c].append(n)

original = lambda c: [c * 100 + b + 1 for b in range(BLOCKS)]

def place(c):  # first anywhere, second in another rack, third beside the second
    a = pick_node(lambda n: True)
    b = pick_node(lambda n: rack(n) != rack(a))
    d = pick_node(lambda n: rack(n) == rack(b) and n != b)
    [write_replica(c, n, original(c)) for n in (a, b, d)]

def live_replicas(c):  # the master's view: it only knows what heartbeats told it
    return [n for n in replicas[c] if not declared_dead[n]]

racks_of = lambda c: len({rack(n) for n in live_replicas(c)})

sound = lambda r: all(mix(v) == r["sums"][b] for b, v in enumerate(r["data"]))

under_replicated = lambda: sum(1 for c in range(CHUNKS) if len(live_replicas(c)) < 3)

def re_replicate(budget):  # fewest surviving copies first, so the most endangered chunks are fixed first
    queue = sorted((len(live_replicas(c)), c) for c in range(CHUNKS) if 0 < len(live_replicas(c)) < 3)
    for _, c in queue[:budget]:
        src = next(n for n in live_replicas(c) if alive[n])
        held = replicas[c]
        target = pick_node(lambda n: n not in held and (racks_of(c) > 1 or rack(n) != rack(src)))
        write_replica(c, target, store[src][c]["data"])
    return len(queue[:budget])

for c in range(CHUNKS):
    place(c)
print(f"placed {CHUNKS} chunks, {CHUNKS * 3} replicas, every chunk on 2+ racks: {str(all(racks_of(c) >= 2 for c in range(CHUNKS))).lower()}")

min_copies, healthy_at = 3, -1
for tick in range(1, 31):
    for n in ([4] if tick == 5 else [6, 7, 8] if tick == 12 else []):
        alive[n] = False  # one server dies, then a whole rack
    for n in range(N):
        if alive[n]:
            last_beat[n] = tick  # heartbeats
        if not declared_dead[n] and tick - last_beat[n] > TIMEOUT:
            declared_dead[n] = True
            print(f"tick {tick}: server {n} declared dead, {under_replicated()} chunks under-replicated")
    min_copies = min([min_copies] + [len(live_replicas(c)) for c in range(CHUNKS)])
    if copied := re_replicate(COPY_BUDGET):
        print(f"tick {tick}: copied {copied}, {under_replicated()} still under-replicated")
    if tick > 16 and healthy_at < 0 and under_replicated() == 0:
        healthy_at = tick
print(f"fewest copies of any chunk: {min_copies}; fully replicated again at tick {healthy_at}")

corrupted = found = repaired = 0
while corrupted < 5:  # bit rot: flip a value in a stored block, leaving the stored checksum alone
    c = rnd(CHUNKS)
    n = live_replicas(c)[rnd(3)]
    r = store[n][c]
    if sound(r):  # skip a replica that is already damaged
        r["data"][rnd(BLOCKS)] ^= 1
        corrupted += 1
for n in range(N):  # scrub: recompute every block checksum on every live server
    if not alive[n]:
        continue
    for c, r in list(store[n].items()):
        if sound(r):
            continue
        found += 1
        del store[n][c]
        replicas[c] = [x for x in replicas[c] if x != n]
while under_replicated() > 0:
    repaired += re_replicate(COPY_BUDGET)
print(f"corrupted {corrupted}, scrub found {found}, repaired {repaired}")

clean = all(sound(store[n][c]) and store[n][c]["data"] == original(c) for c in range(CHUNKS) for n in live_replicas(c))
ok = clean and under_replicated() == 0 and min_copies >= 1 and found == corrupted and all(
    racks_of(c) >= 2 and len(live_replicas(c)) == 3 for c in range(CHUNKS))
print(f"all replicas verify, 3 copies on 2+ racks: {str(ok).lower()}")
raise SystemExit(0 if ok else 1)
