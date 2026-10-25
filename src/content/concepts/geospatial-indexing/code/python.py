# Geospatial indexing: find restaurants within 2 km with a geohash index, compared with a full scan.
# Restaurants are generated around central Berlin with an integer generator, so every run prints the same.
# The index maps each 5-character geohash (a cell about 3.0 km wide and 4.9 km tall at this latitude) to its restaurants.
import math

BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"
EARTH_RADIUS_M = 6371000
CITY_LAT_E6, CITY_LNG_E6 = 52520000, 13405000  # micro-degrees
COUNT, PRECISION, RADIUS_M = 600, 5, 2000
USER_LAT, USER_LNG = 52.5175, 13.4170  # a few hundred metres from a cell edge

seed = 2024  # Park-Miller generator, integers only so every language prints the same
def next_rand(n):
    global seed
    seed = (seed * 48271) % 2147483647
    return seed % n


def encode(lat, lng, precision):
    # Interleave longitude and latitude bits (longitude first), 5 bits per base-32 character.
    lat_lo, lat_hi, lng_lo, lng_hi = -90.0, 90.0, -180.0, 180.0
    out, bits, value, even_bit = "", 0, 0, True
    while len(out) < precision:
        if even_bit:
            mid = (lng_lo + lng_hi) / 2
            if lng >= mid:
                value, lng_lo = value * 2 + 1, mid
            else:
                value, lng_hi = value * 2, mid
        else:
            mid = (lat_lo + lat_hi) / 2
            if lat >= mid:
                value, lat_lo = value * 2 + 1, mid
            else:
                value, lat_hi = value * 2, mid
        even_bit = not even_bit
        bits += 1
        if bits == 5:
            out += BASE32[value]
            bits, value = 0, 0
    return out


def bounds(cell):
    # The rectangle a geohash stands for: [lat_lo, lat_hi, lng_lo, lng_hi].
    lat_lo, lat_hi, lng_lo, lng_hi, even_bit = -90.0, 90.0, -180.0, 180.0, True
    for ch in cell:
        v = BASE32.index(ch)
        for b in range(4, -1, -1):
            bit = (v >> b) & 1
            if even_bit:
                mid = (lng_lo + lng_hi) / 2
                if bit:
                    lng_lo = mid
                else:
                    lng_hi = mid
            else:
                mid = (lat_lo + lat_hi) / 2
                if bit:
                    lat_lo = mid
                else:
                    lat_hi = mid
            even_bit = not even_bit
    return lat_lo, lat_hi, lng_lo, lng_hi


def cell_and_neighbours(cell):
    # Step one cell height or width from the centre of this cell in each of the 8 directions (no pole or date-line wrap).
    lat_lo, lat_hi, lng_lo, lng_hi = bounds(cell)
    h, w = lat_hi - lat_lo, lng_hi - lng_lo
    c_lat, c_lng = (lat_lo + lat_hi) / 2, (lng_lo + lng_hi) / 2
    return [encode(c_lat + dy * h, c_lng + dx * w, len(cell)) for dy in (-1, 0, 1) for dx in (-1, 0, 1)]


def haversine_m(lat1, lng1, lat2, lng2):
    rad = math.pi / 180
    d_lat, d_lng = (lat2 - lat1) * rad, (lng2 - lng1) * rad
    a = math.sin(d_lat / 2) ** 2 + math.cos(lat1 * rad) * math.cos(lat2 * rad) * math.sin(d_lng / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


# 70% of the restaurants within about 2 km of the centre, the rest spread over about 9 km.
places = []
for i in range(COUNT):
    dense = next_rand(10) < 7
    lat_span, lng_span = (20000, 33000) if dense else (80000, 130000)
    lat = (CITY_LAT_E6 + next_rand(2 * lat_span + 1) - lat_span) / 1e6
    lng = (CITY_LNG_E6 + next_rand(2 * lng_span + 1) - lng_span) / 1e6
    places.append({"id": i, "lat": lat, "lng": lng, "cell": encode(lat, lng, PRECISION)})

# The index: geohash cell -> restaurants. In Redis or a database this is an ordinary sorted key.
index = {}
for p in places:
    index.setdefault(p["cell"], []).append(p)


def search(cells):
    candidates = [p for c in cells for p in index.get(c, [])]
    found = [p for p in candidates if haversine_m(USER_LAT, USER_LNG, p["lat"], p["lng"]) <= RADIUS_M]
    return len(candidates), found


user_cell = encode(USER_LAT, USER_LNG, PRECISION)
print(f"self-check: encode(57.64911, 10.40744, 11) = {encode(57.64911, 10.40744, 11)}")
print(f"user at {USER_LAT}, {USER_LNG} -> cell {user_cell}, longer prefix {encode(USER_LAT, USER_LNG, 7)}")
for p in range(4, 8):
    lat_lo, lat_hi, lng_lo, lng_hi = bounds(encode(USER_LAT, USER_LNG, p))
    tall = (lat_hi - lat_lo) * 111320
    wide = (lng_hi - lng_lo) * 111320 * math.cos(USER_LAT * math.pi / 180)
    print(f"precision {p}: cell about {math.floor(wide + 0.5)} m wide x {math.floor(tall + 0.5)} m tall")
print(f"{COUNT} restaurants in {len(index)} cells of precision {PRECISION}")

scan = search(list(index.keys()))
own = search([user_cell])
nine = search(cell_and_neighbours(user_cell))
total = len(scan[1])
for name, (checked, found) in (("full scan", scan), ("own cell only", own), ("cell + 8 neighbours", nine)):
    print(f"{name:<20} checked={checked:>3} found={len(found):>3} missed={total - len(found)}")
print(f"neighbour cells: {' '.join(cell_and_neighbours(user_cell))}")

nearest = sorted(((haversine_m(USER_LAT, USER_LNG, p["lat"], p["lng"]), p["id"], p) for p in nine[1]), key=lambda t: (t[0], t[1]))[:3]
for d, _, p in nearest:
    print(f"restaurant {p['id']} in {p['cell']}: {math.floor(d + 0.5)} m")
