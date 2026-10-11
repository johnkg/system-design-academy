// A two-level CDN cache (edge PoPs in front of one regional shield) in JavaScript:
// least-recently-used eviction, expiry by TTL, and the choice of joining a fetch that is already under way.
const TTL = 20000, EDGE_CAP = 200, SHIELD_CAP = 500, POPS = 4, REQUESTS = 20000;
const EDGE_SHIELD = 16, ORIGIN_TRIP = 80, ORIGIN_WORK = 30; // milliseconds: edge to shield and back, origin round trip, origin processing

class Cache {
  constructor(cap) { this.cap = cap; this.items = new Map(); this.tick = 0; this.hits = 0; this.joined = 0; this.misses = 0; }

  // Returns how long the caller waits (ms) until the object is available at this level.
  lookup(key, now, coalesce, fetch) {
    const e = this.items.get(key);
    if (e && e.expires > now) {
      if (e.ready <= now) { e.used = ++this.tick; this.hits++; return 0; }       // fresh copy: a hit
      if (coalesce) { this.joined++; return e.ready - now; }                      // a fetch is under way: wait for it
    }
    this.misses++;
    const wait = fetch();                                                          // expired, absent, or not joining: fetch again
    this.items.set(key, { ready: now + wait, expires: now + wait + TTL, used: ++this.tick });
    while (this.items.size > this.cap) {                                           // evict the least recently used
      let oldest = -1, oldestUsed = Infinity;
      for (const [k, v] of this.items) if (v.used < oldestUsed) { oldest = k; oldestUsed = v.used; }
      this.items.delete(oldest);
    }
    return wait;
  }
}

function simulate(shielded, coalesce) {
  let seed = 99;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 8; };
  const edges = Array.from({ length: POPS }, () => new Cache(EDGE_CAP)), shield = new Cache(SHIELD_CAP);
  let now = 0, origin = 0, totalWait = 0;
  const fromOrigin = () => { origin++; return ORIGIN_TRIP + ORIGIN_WORK; };
  for (let i = 0; i < REQUESTS; i++) {
    now += 1 + (next() % 3);
    const u = next() % 10000, key = Math.floor((u * u * u) / 2000000000);          // cubing a uniform number favours low keys: a few popular objects
    const edge = edges[next() % POPS];
    totalWait += edge.lookup(key, now, coalesce, () => (shielded ? EDGE_SHIELD + shield.lookup(key, now, coalesce, fromOrigin) : fromOrigin()));
  }
  const sum = (f) => edges.reduce((s, e) => s + f(e), 0);
  const ok = edges.every((e) => e.items.size <= EDGE_CAP) && sum((e) => e.hits + e.joined + e.misses) === REQUESTS;
  return { origin, hits: sum((e) => e.hits), joined: sum((e) => e.joined), wait: Math.floor(totalWait / REQUESTS), ok };
}

// 100 requests for a new object arrive within 100 ms while its fetch takes 110 ms.
function herd(coalesce) {
  const cache = new Cache(10); let fetches = 0;
  for (let t = 0; t < 100; t++) cache.lookup(7, t, coalesce, () => { fetches++; return 110; });
  return fetches;
}

const runs = [[false, false, 'edge only'], [false, true, 'edge only + coalescing'], [true, false, 'edge + shield'], [true, true, 'edge + shield + coalescing']]
  .map(([shielded, coalesce, name]) => ({ name, ...simulate(shielded, coalesce) }));
for (const r of runs) console.log(`${r.name}: ${r.origin} origin requests, edge hit ratio ${Math.floor((r.hits * 1000) / REQUESTS)} per mille, ${r.joined} joined, average wait ${r.wait} ms`);
const [loose, joined, shielded, both] = runs;
console.log(`herd of 100 requests: ${herd(false)} origin fetches without coalescing, ${herd(true)} with it`);
console.log(`origin load: ${loose.origin} -> ${both.origin} (${Math.floor((both.origin * 100) / loose.origin)}% of the edge-only load)`);

const good = runs.every((r) => r.ok) && joined.origin <= loose.origin && shielded.origin < loose.origin && both.origin <= shielded.origin && both.origin < loose.origin && herd(false) === 100 && herd(true) === 1;
if (!good) process.exit(1);
