// A cache cluster in JavaScript, in four small parts:
// 1) a consistent-hash ring with virtual nodes, 2) an LRU cache with a memory limit and TTLs,
// 3) single flight against a stampede, 4) TTL jitter against a mass expiry.

// A 32-bit hash: FNV-1a, then a final mix so that similar strings land far apart.
const hash = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
};

class Ring {
  constructor(nodeCount, vnodes) {
    this.points = []; // [position on the ring, node], sorted by position
    for (let n = 0; n < nodeCount; n++) for (let v = 0; v < vnodes; v++) this.points.push([hash(`node${n}#${v}`), n]);
    this.points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }
  owner(key) { // the first point clockwise from the key, wrapping around
    const h = hash(key);
    let lo = 0, hi = this.points.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.points[mid][0] < h) lo = mid + 1; else hi = mid; }
    return this.points[lo % this.points.length][1];
  }
}

// An LRU cache with a limit on the number of entries and a time to live. The Map keeps insertion order, so the first key is the oldest use.
class Cache {
  constructor(capacity) { this.capacity = capacity; this.map = new Map(); this.evicted = []; }
  get(key, now) {
    const e = this.map.get(key);
    if (!e) return undefined;
    this.map.delete(key);
    if (e.expires <= now) return undefined;   // expired: behaves as a miss
    this.map.set(key, e);                     // a use moves it to the newest end
    return e.value;
  }
  set(key, value, now, ttl) {
    this.map.delete(key);
    this.map.set(key, { value, expires: now + ttl });
    while (this.map.size > this.capacity) { const oldest = this.map.keys().next().value; this.map.delete(oldest); this.evicted.push(oldest); }
  }
}

// A key expires at time 100 ms; one request per millisecond arrives until 200 ms, and a database load takes 40 ms.
function stampede(singleFlight) {
  let loads = 0, ready = Infinity, started = false;
  for (let t = 100; t < 200; t++) {
    if (t >= ready) continue;                 // refilled: a hit
    if (singleFlight && started) continue;    // waits for the load already running
    loads++; started = true; ready = Math.min(ready, t + 40);
  }
  return loads;
}

const keys = Array.from({ length: 10000 }, (_, i) => `user:${i}`);

const ring4 = new Ring(4, 100), ring5 = new Ring(5, 100);
const load = [0, 0, 0, 0];
const before = keys.map((k) => { const n = ring4.owner(k); load[n]++; return n; });
console.log(`keys per node on 4 nodes x 100 vnodes: ${load.join(', ')}`);
let moved = 0, toNew = true, modMoved = 0;
keys.forEach((k, i) => {
  const after = ring5.owner(k);
  if (after !== before[i]) { moved++; if (after !== 4) toNew = false; }
  if (hash(k) % 4 !== hash(k) % 5) modMoved++;
});
console.log(`adding a 5th node moves ${moved} keys on the ring, all to the new node: ${toNew}; hash mod N would move ${modMoved}`);

const cache = new Cache(3);
cache.set('a', 1, 0, 100); cache.set('b', 2, 0, 100); cache.set('c', 3, 0, 100);
cache.get('a', 10);                  // a is now the newest, so b is the oldest
cache.set('d', 4, 20, 100);          // over the limit: b is evicted
console.log(`evicted: ${cache.evicted.join(',')}; a=${cache.get('a', 30) ?? 'miss'}, b=${cache.get('b', 30) ?? 'miss'}; a after its TTL=${cache.get('a', 150) ?? 'miss'}`);

const plain = stampede(false), single = stampede(true);
console.log(`database loads while refilling: ${plain} without protection, ${single} with single flight`);

const peak = (jitter) => {
  const perSecond = new Map();
  for (const k of keys.slice(0, 1000)) {
    const ttl = 300000 + (jitter ? (hash(k) % 60000) - 30000 : 0); // +/- 10%
    const s = Math.floor(ttl / 1000);
    perSecond.set(s, (perSecond.get(s) || 0) + 1);
  }
  return Math.max(...perSecond.values());
};
const [flat, spread] = [peak(false), peak(true)];
console.log(`1000 keys cached together: most expiries in one second is ${flat} without jitter, ${spread} with it`);

const ok = toNew && moved < 3000 && modMoved > 7000 && Math.min(...load) > 2000 && plain === 40 && single === 1 && flat === 1000 && spread < 50
  && cache.evicted.join() === 'b' && cache.get('b', 30) === undefined;
if (!ok) process.exit(1);
