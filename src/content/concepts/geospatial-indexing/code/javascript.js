// Geospatial indexing: find restaurants within 2 km with a geohash index, compared with a full scan.
// Restaurants are generated around central Berlin with an integer generator, so every run prints the same.
// The index maps each 5-character geohash (a cell about 3.0 km wide and 4.9 km tall at this latitude) to its restaurants.
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
const EARTH_RADIUS_M = 6371000;
const CITY_LAT_E6 = 52520000, CITY_LNG_E6 = 13405000; // micro-degrees
const COUNT = 600, PRECISION = 5, RADIUS_M = 2000;
const USER_LAT = 52.5175, USER_LNG = 13.4170; // a few hundred metres from a cell edge

let seed = 2024; // Park-Miller generator, integers only so every language prints the same
function nextRand(n) {
  seed = (seed * 48271) % 2147483647;
  return seed % n;
}

function encode(lat, lng, precision) {
  // Interleave longitude and latitude bits (longitude first), 5 bits per base-32 character.
  let latLo = -90, latHi = 90, lngLo = -180, lngHi = 180;
  let hash = "", bits = 0, value = 0, evenBit = true;
  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lngLo + lngHi) / 2;
      if (lng >= mid) { value = value * 2 + 1; lngLo = mid; } else { value = value * 2; lngHi = mid; }
    } else {
      const mid = (latLo + latHi) / 2;
      if (lat >= mid) { value = value * 2 + 1; latLo = mid; } else { value = value * 2; latHi = mid; }
    }
    evenBit = !evenBit;
    if (++bits === 5) { hash += BASE32[value]; bits = 0; value = 0; }
  }
  return hash;
}

function bounds(hash) {
  // The rectangle a geohash stands for: [latLo, latHi, lngLo, lngHi].
  let latLo = -90, latHi = 90, lngLo = -180, lngHi = 180, evenBit = true;
  for (const ch of hash) {
    const v = BASE32.indexOf(ch);
    for (let b = 4; b >= 0; b--) {
      const bit = (v >> b) & 1;
      if (evenBit) { const mid = (lngLo + lngHi) / 2; if (bit) lngLo = mid; else lngHi = mid; }
      else { const mid = (latLo + latHi) / 2; if (bit) latLo = mid; else latHi = mid; }
      evenBit = !evenBit;
    }
  }
  return [latLo, latHi, lngLo, lngHi];
}

function cellAndNeighbours(hash) {
  // Step one cell height or width from the centre of this cell in each of the 8 directions (no pole or date-line wrap).
  const [latLo, latHi, lngLo, lngHi] = bounds(hash);
  const h = latHi - latLo, w = lngHi - lngLo, cLat = (latLo + latHi) / 2, cLng = (lngLo + lngHi) / 2;
  const out = [];
  for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) out.push(encode(cLat + dy * h, cLng + dx * w, hash.length));
  return out;
}

function haversineM(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

// 70% of the restaurants within about 2 km of the centre, the rest spread over about 9 km.
const places = [];
for (let i = 0; i < COUNT; i++) {
  const dense = nextRand(10) < 7;
  const latSpan = dense ? 20000 : 80000, lngSpan = dense ? 33000 : 130000;
  const lat = (CITY_LAT_E6 + nextRand(2 * latSpan + 1) - latSpan) / 1e6;
  const lng = (CITY_LNG_E6 + nextRand(2 * lngSpan + 1) - lngSpan) / 1e6;
  places.push({ id: i, lat, lng, cell: encode(lat, lng, PRECISION) });
}

// The index: geohash cell -> restaurants. In Redis or a database this is an ordinary sorted key.
const index = new Map();
for (const p of places) {
  if (!index.has(p.cell)) index.set(p.cell, []);
  index.get(p.cell).push(p);
}

function search(cells) {
  const candidates = cells.flatMap((c) => index.get(c) ?? []);
  const found = candidates.filter((p) => haversineM(USER_LAT, USER_LNG, p.lat, p.lng) <= RADIUS_M);
  return { checked: candidates.length, found };
}

const userCell = encode(USER_LAT, USER_LNG, PRECISION);
console.log(`self-check: encode(57.64911, 10.40744, 11) = ${encode(57.64911, 10.40744, 11)}`);
console.log(`user at ${USER_LAT}, ${USER_LNG} -> cell ${userCell}, longer prefix ${encode(USER_LAT, USER_LNG, 7)}`);
for (let p = 4; p <= 7; p++) {
  const [latLo, latHi, lngLo, lngHi] = bounds(encode(USER_LAT, USER_LNG, p));
  const tall = (latHi - latLo) * 111320, wide = (lngHi - lngLo) * 111320 * Math.cos(USER_LAT * Math.PI / 180);
  console.log(`precision ${p}: cell about ${Math.floor(wide + 0.5)} m wide x ${Math.floor(tall + 0.5)} m tall`);
}
console.log(`${COUNT} restaurants in ${index.size} cells of precision ${PRECISION}`);

const scan = search([...index.keys()]);
const own = search([userCell]);
const nine = search(cellAndNeighbours(userCell));
const total = scan.found.length;
for (const [name, r] of [["full scan", scan], ["own cell only", own], ["cell + 8 neighbours", nine]]) {
  console.log(`${name.padEnd(20)} checked=${String(r.checked).padStart(3)} found=${String(r.found.length).padStart(3)} missed=${total - r.found.length}`);
}
console.log(`neighbour cells: ${cellAndNeighbours(userCell).join(" ")}`);

const nearest = nine.found
  .map((p) => ({ p, d: haversineM(USER_LAT, USER_LNG, p.lat, p.lng) }))
  .sort((a, b) => a.d - b.d || a.p.id - b.p.id)
  .slice(0, 3);
for (const { p, d } of nearest) console.log(`restaurant ${p.id} in ${p.cell}: ${Math.floor(d + 0.5)} m`);
