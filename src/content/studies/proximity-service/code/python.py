# Places within a radius, in Python:
# places are sorted by the Z-order key of their cell (the idea behind a geohash), so each grid cell is one contiguous range of the sorted list.
# A radius search reads the query's cell and its 8 neighbours, then measures the true distance of only those candidates.
import sys
from bisect import bisect_left

BITS = 12
SIZE = 1 << BITS              # a 4096 by 4096 map; one unit is 10 metres, so the map is about 41 km wide
CITY_PLACES = 3000  # a dense city around (1200, 1200), +-300 units
CITY_X = 1200
CITY_Y = 1200
CITY_SPREAD = 300
TOWN_PLACES = 400  # a small town around (3000, 2800), +-100 units
TOWN_X = 3000
TOWN_Y = 2800
TOWN_SPREAD = 100
RURAL_PLACES = 600  # places anywhere on the map
QUERIES = 300  # random searches
MIN_RADIUS = 40  # search radius 40..240 units
RADIUS_SPREAD = 201

seed = 99


def random(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


# Z-order key: interleave the bits of x and y, most significant first. Cells that share a prefix are nested squares.
def zkey(x, y):
    k = 0
    for b in range(BITS - 1, -1, -1):
        k = k * 4 + (((x >> b) & 1) * 2 + ((y >> b) & 1))
    return k


places = []


def add(x, y):
    x = min(SIZE - 1, max(0, x))
    y = min(SIZE - 1, max(0, y))
    places.append({"x": x, "y": y, "key": zkey(x, y)})


for _ in range(CITY_PLACES):
    add(CITY_X + random(CITY_SPREAD) + random(CITY_SPREAD) - CITY_SPREAD, CITY_Y + random(CITY_SPREAD) + random(CITY_SPREAD) - CITY_SPREAD)  # a dense city
for _ in range(TOWN_PLACES):
    add(TOWN_X + random(TOWN_SPREAD) + random(TOWN_SPREAD) - TOWN_SPREAD, TOWN_Y + random(TOWN_SPREAD) + random(TOWN_SPREAD) - TOWN_SPREAD)  # a small town
for _ in range(RURAL_PLACES):
    add(random(SIZE), random(SIZE))                                                      # places everywhere else
places.sort(key=lambda p: (p["key"], p["x"], p["y"]))
keys = [p["key"] for p in places]


# First index whose key is at least the given key (binary search).
def lower_bound(key):
    return bisect_left(keys, key)


# The cell is the smallest power-of-two square at least as wide as the radius, so the circle reaches at most one cell away.
def search(qx, qy, r, neighbours):
    s = 0
    while (1 << s) < r:
        s += 1
    cx, cy, cells, reach = qx >> s, qy >> s, SIZE >> s, 1 if neighbours else 0
    hits = 0
    examined = lookups = 0
    for dx in range(-reach, reach + 1):
        for dy in range(-reach, reach + 1):
            x, y = cx + dx, cy + dy
            if x < 0 or y < 0 or x >= cells or y >= cells:
                continue
            lo = zkey(x << s, y << s)
            hi = lo + (1 << (2 * s))
            lookups += 1
            i = lower_bound(lo)
            while i < len(places) and places[i]["key"] < hi:
                examined += 1
                p = places[i]
                if (p["x"] - qx) ** 2 + (p["y"] - qy) ** 2 <= r * r:
                    hits += 1
                i += 1
    return {"hits": hits, "examined": examined, "lookups": lookups, "cell_width": 1 << s}


def brute_force(qx, qy, r):
    return sum(1 for p in places if (p["x"] - qx) ** 2 + (p["y"] - qy) ** 2 <= r * r)


# One query in the city, 20 units from a cell edge, with a radius of 1.5 km.
qx, qy, r = 1260, 1230, 150
truth, own, nine = brute_force(qx, qy, r), search(qx, qy, r, False), search(qx, qy, r, True)
print(f"{len(places)} places; cells are {nine['cell_width']} units wide for a radius of {r}")
print(f"full scan: {truth} results, {len(places)} examined")
print(f"own cell only: {own['hits']} results, {own['examined']} examined, {own['lookups']} lookup")
print(f"cell and 8 neighbours: {nine['hits']} results, {nine['examined']} examined, {nine['lookups']} lookups")

# 300 queries all over the map with radii from 40 to 240 units.
total = own_total = nine_total = examined = 0
exact = True
for _ in range(QUERIES):
    x, y, radius = random(SIZE), random(SIZE), MIN_RADIUS + random(RADIUS_SPREAD)
    t, a, b = brute_force(x, y, radius), search(x, y, radius, False), search(x, y, radius, True)
    total += t
    own_total += a["hits"]
    nine_total += b["hits"]
    examined += b["examined"]
    if b["hits"] != t:
        exact = False
print(f"300 queries: {total} results, own cell found {own_total}, with neighbours found {nine_total}, examined {examined} instead of {300 * len(places)}")
if not exact or own["hits"] >= truth or nine["hits"] != truth or own_total >= total or examined >= QUERIES * len(places):
    sys.exit(1)
