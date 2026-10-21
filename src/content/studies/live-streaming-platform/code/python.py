# A live stream through a CDN, in Python:
# a rendition ladder, segment requests through edge and shield caches, glass-to-glass latency and an ingest failover.
import sys

LADDER = [("1080p", 6000), ("720p", 3000), ("480p", 1200), ("240p", 400)]  # name and kbit/s
SHARE = [20, 40, 30, 10]  # percent of viewers who settle on each rendition
SEG_MS, SEGS, EDGES, VIEWERS = 2000, 30, 8, 2000
MS_PER_SECOND, PER_VIEWERS = 1000, 1000  # request rates are quoted per 1000 viewers
INGEST_MS, TRANSCODE_MS, DELIVERY_MS = 300, 500, 400
# Failover demo: the stream dies at 25.3 s; a cold standby needs 2 s to notice and 3 s to start, a warm one 1 s and none.
FAIL_AT, COLD_DETECT_MS, COLD_START_MS, WARM_DETECT_MS = 25300, 2000, 3000, 1000

SEED = 7
seed = SEED


def rnd(n):
    """Linear congruential generator (Numerical Recipes constants), high 16 bits."""
    global seed
    seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
    return (seed >> 16) % n


def make_viewers():
    result = []
    for _ in range(VIEWERS):
        pick, r = rnd(100), 0
        while pick >= SHARE[r]:
            pick -= SHARE[r]
            r += 1
        result.append((r, rnd(EDGES)))
    return result


viewers = make_viewers()


def deliver(use_shield):
    """Every viewer asks its edge for every segment. A miss goes to the shield (if any), then to the origin.
    Requests for a key that is already cached, or already on its way, are coalesced and do not go further."""
    edge_seen, shield_seen = set(), set()
    origin = origin_kbit = 0
    for seg in range(SEGS):
        for rendition, edge in viewers:
            if (edge, rendition, seg) in edge_seen:
                continue
            edge_seen.add((edge, rendition, seg))
            key = (rendition, seg)
            if use_shield and key in shield_seen:
                continue
            shield_seen.add(key)
            origin += 1
            origin_kbit += LADDER[rendition][1] * (SEG_MS // MS_PER_SECOND)
    return origin, origin_kbit


def glass_to_glass(unit_ms, held):
    """Delay from camera to screen: ingest, transcode, wait for a whole unit, the player's hold-back, delivery."""
    return INGEST_MS + TRANSCODE_MS + unit_ms + held * unit_ms + DELIVERY_MS


def failover(fail_at, detect_ms, start_ms):
    """Milliseconds with no segments: the standby resumes on the next segment boundary after it has started."""
    last_good = fail_at // SEG_MS * SEG_MS
    resume = -(-(fail_at + detect_ms + start_ms) // SEG_MS) * SEG_MS
    return resume - last_good


def stalls(gap, held):
    return "stalls" if gap > held * SEG_MS else "plays on"


print("ladder: " + " ".join(f"{n}={k}" for n, k in LADDER) + f" total {sum(k for _, k in LADDER)} kbit/s")
plain, plain_kbit = deliver(False)
shielded, shielded_kbit = deliver(True)
print(f"requests to origin over {SEGS} segments: {plain} without shield, {shielded} with shield")
print(f"origin egress: {plain_kbit} kbit without shield, {shielded_kbit} with shield")
for name, unit, held in [("6 s segments, hold 3", 6000, 3), ("2 s segments, hold 3", 2000, 3),
                         ("2 s segments, hold 2", 2000, 2), ("0.5 s parts, hold 3", 500, 3)]:
    print(f"{name}: {glass_to_glass(unit, held)} ms, {PER_VIEWERS * MS_PER_SECOND // unit} requests/s per 1000 viewers")
cold, warm = failover(FAIL_AT, COLD_DETECT_MS, COLD_START_MS), failover(FAIL_AT, WARM_DETECT_MS, 0)
print(f"failover gap: cold standby {cold} ms, warm standby {warm} ms, dual active 0 ms")
print(f"viewer holding 1 segment: cold {stalls(cold, 1)}, warm {stalls(warm, 1)}; "
      f"holding 3: cold {stalls(cold, 3)}, warm {stalls(warm, 3)}")

if shielded != len(LADDER) * SEGS:  # one fetch per rendition and segment
    sys.exit(1)
if plain <= shielded * 4:  # without a shield every edge fetches on its own
    sys.exit(2)
if glass_to_glass(500, 3) >= glass_to_glass(2000, 2):
    sys.exit(3)
if warm >= cold:
    sys.exit(4)
