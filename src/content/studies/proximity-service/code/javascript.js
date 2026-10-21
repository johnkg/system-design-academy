// Places within a radius, in JavaScript:
// places are sorted by the Z-order key of their cell (the idea behind a geohash), so each grid cell is one contiguous range of the sorted list.
// A radius search reads the query's cell and its 8 neighbours, then measures the true distance of only those candidates.

const BITS = 12, SIZE = 1 << BITS;              // a 4096 by 4096 map; one unit is 10 metres, so the map is about 41 km wide
const CITY_PLACES = 3000; // a dense city around (1200, 1200), +-300 units
const CITY_X = 1200;
const CITY_Y = 1200;
const CITY_SPREAD = 300;
const TOWN_PLACES = 400; // a small town around (3000, 2800), +-100 units
const TOWN_X = 3000;
const TOWN_Y = 2800;
const TOWN_SPREAD = 100;
const RURAL_PLACES = 600; // places anywhere on the map
const QUERIES = 300; // random searches
const MIN_RADIUS = 40; // search radius 40..240 units
const RADIUS_SPREAD = 201;

let seed = 99;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

// Z-order key: interleave the bits of x and y, most significant first. Cells that share a prefix are nested squares.
const zkey = (x, y) => { let k = 0; for (let b = BITS - 1; b >= 0; b--) k = k * 4 + (((x >> b) & 1) * 2 + ((y >> b) & 1)); return k; };

const places = [];
const add = (x, y) => { x = Math.min(SIZE - 1, Math.max(0, x)); y = Math.min(SIZE - 1, Math.max(0, y)); places.push({ x, y, key: zkey(x, y) }); };
for (let i = 0; i < CITY_PLACES; i++) add(CITY_X + random(CITY_SPREAD) + random(CITY_SPREAD) - CITY_SPREAD, CITY_Y + random(CITY_SPREAD) + random(CITY_SPREAD) - CITY_SPREAD); // a dense city
for (let i = 0; i < TOWN_PLACES; i++) add(TOWN_X + random(TOWN_SPREAD) + random(TOWN_SPREAD) - TOWN_SPREAD, TOWN_Y + random(TOWN_SPREAD) + random(TOWN_SPREAD) - TOWN_SPREAD);  // a small town
for (let i = 0; i < RURAL_PLACES; i++) add(random(SIZE), random(SIZE));                                                      // places everywhere else
places.sort((a, b) => a.key - b.key || a.x - b.x || a.y - b.y);

// First index whose key is at least the given key (binary search).
function lowerBound(key) {
  let lo = 0, hi = places.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (places[mid].key < key) lo = mid + 1; else hi = mid; }
  return lo;
}

// The cell is the smallest power-of-two square at least as wide as the radius, so the circle reaches at most one cell away.
function search(qx, qy, r, neighbours) {
  let s = 0; while ((1 << s) < r) s++;
  const cx = qx >> s, cy = qy >> s, cells = SIZE >> s, reach = neighbours ? 1 : 0;
  const hits = []; let examined = 0, lookups = 0;
  for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) {
    const x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || x >= cells || y >= cells) continue;
    const lo = zkey(x << s, y << s), hi = lo + (1 << (2 * s)); lookups++;
    for (let i = lowerBound(lo); i < places.length && places[i].key < hi; i++) {
      examined++;
      const p = places[i];
      if ((p.x - qx) ** 2 + (p.y - qy) ** 2 <= r * r) hits.push(p);
    }
  }
  return { hits: hits.length, examined, lookups, cellWidth: 1 << s };
}

const bruteForce = (qx, qy, r) => places.filter((p) => (p.x - qx) ** 2 + (p.y - qy) ** 2 <= r * r).length;

// One query in the city, 20 units from a cell edge, with a radius of 1.5 km.
const qx = 1260, qy = 1230, r = 150;
const truth = bruteForce(qx, qy, r), own = search(qx, qy, r, false), nine = search(qx, qy, r, true);
console.log(`${places.length} places; cells are ${nine.cellWidth} units wide for a radius of ${r}`);
console.log(`full scan: ${truth} results, ${places.length} examined`);
console.log(`own cell only: ${own.hits} results, ${own.examined} examined, ${own.lookups} lookup`);
console.log(`cell and 8 neighbours: ${nine.hits} results, ${nine.examined} examined, ${nine.lookups} lookups`);

// 300 queries all over the map with radii from 40 to 240 units.
let total = 0, ownTotal = 0, nineTotal = 0, examined = 0, exact = true;
for (let i = 0; i < QUERIES; i++) {
  const x = random(SIZE), y = random(SIZE), radius = MIN_RADIUS + random(RADIUS_SPREAD);
  const t = bruteForce(x, y, radius), a = search(x, y, radius, false), b = search(x, y, radius, true);
  total += t; ownTotal += a.hits; nineTotal += b.hits; examined += b.examined;
  if (b.hits !== t) exact = false;
}
console.log(`300 queries: ${total} results, own cell found ${ownTotal}, with neighbours found ${nineTotal}, examined ${examined} instead of ${300 * places.length}`);
if (!exact || own.hits >= truth || nine.hits !== truth || ownTotal >= total || examined >= QUERIES * places.length) process.exit(1);
