// A cache in front of a database, tried with different eviction policies on the same 200,000 requests. 85% of the
// requests ask for 1,000 hot keys (some hotter than others) and 15% for one of 50,000 cold keys. In one variant a
// report job reads 20,000 old keys once, between request 80,000 and 120,000. In another the hot set moves to other keys
// at request 140,000. The requests come from a seeded generator, so the output never changes. Integers only.
const REQUESTS = 200000;
const HOT = 1000, HOT_PCT = 85;                 // hot keys, and the share of requests that ask for them
const COLD_BASE = 5000, COLD = 50000;           // the cold keys: 5,000 up to 54,999
const SHIFT_BASE = 2000;                        // after the shift the hot keys are 2,000 up to 2,999
const SCAN_BASE = 100000;                       // keys read once by the report job
const SCAN_START = 80000, SCAN_END = 120000;    // the report reads one new key every second request in this window
const SHIFT_AT = 140000;                        // the hot set moves here
const MEMORY_LIMIT = 10000;                     // entries an unbounded map can hold before the process is killed
const SEED = 20261121;

// Park-Miller generator: 48,271 * 2,147,483,646 is below 2^53, so plain numbers stay exact in every language.
function makeRandom(seed) {
  let state = seed;
  return () => (state = (state * 48271) % 2147483647);
}

function run(name, { policy, size, scan, shift, ttl }) {
  const next = makeRandom(SEED);
  const lfu = policy === 'lfu';
  const order = new Map();    // lru, fifo and unbounded: keys from oldest to newest (a Map keeps insertion order)
  const freq = new Map();     // lfu: how often each key was used
  const buckets = new Map();  // lfu: use count -> keys with that count, oldest first
  const born = new Map();     // key -> request number when it was stored
  let minFreq = 1, count = 0, peak = 0, restarts = 0, evictions = 0, expired = 0, dbReads = 0;
  const hits = [0, 0, 0, 0], asked = [0, 0, 0, 0]; // before the scan, during it, in between, after the shift
  const oldest = (m) => m.keys().next().value;
  const bucket = (f) => { if (!buckets.has(f)) buckets.set(f, new Map()); return buckets.get(f); };

  function remove(key) {
    if (lfu) {
      const f = freq.get(key), b = buckets.get(f);
      b.delete(key);
      if (b.size === 0) buckets.delete(f);
      freq.delete(key);
    } else order.delete(key);
    born.delete(key);
    count--;
  }

  for (let i = 0; i < REQUESTS; i++) {
    let key;
    if (scan && i >= SCAN_START && i < SCAN_END && i % 2 === 0) key = SCAN_BASE + (i - SCAN_START) / 2;
    else if (next() % 100 < HOT_PCT) key = (shift && i >= SHIFT_AT ? SHIFT_BASE : 0) + Math.min(next() % HOT, next() % HOT);
    else key = COLD_BASE + (next() % COLD);
    const regular = key < SCAN_BASE;
    const phase = i < SCAN_START ? 0 : i < SCAN_END ? 1 : i < SHIFT_AT ? 2 : 3;

    let found = lfu ? freq.has(key) : order.has(key);
    if (found && ttl > 0 && i - born.get(key) >= ttl) { expired++; remove(key); found = false; }
    if (regular) asked[phase]++;
    if (found) {
      if (regular) hits[phase]++;
      if (lfu) { // move to the next use count, at the newest end of its bucket
        const f = freq.get(key), b = buckets.get(f);
        b.delete(key);
        if (b.size === 0) { buckets.delete(f); if (minFreq === f) minFreq = f + 1; }
        freq.set(key, f + 1);
        bucket(f + 1).set(key, true);
      } else if (policy === 'lru') { order.delete(key); order.set(key, true); } // newest end
      continue;
    }
    dbReads++;
    if (policy === 'none') {
      if (count >= MEMORY_LIMIT) { order.clear(); born.clear(); count = 0; restarts++; } // out of memory: restart, cache gone
    } else if (count >= size) {
      while (lfu && !buckets.has(minFreq)) minFreq++;
      remove(lfu ? oldest(buckets.get(minFreq)) : oldest(order));
      evictions++;
    }
    if (lfu) { freq.set(key, 1); bucket(1).set(key, true); minFreq = 1; } else order.set(key, true);
    born.set(key, i);
    count++;
    peak = Math.max(peak, count);
  }

  const pct = (h, a) => (a === 0 ? 0 : Math.floor((h * 100) / a));
  const allHits = hits.reduce((s, v) => s + v, 0), allAsked = asked.reduce((s, v) => s + v, 0);
  console.log(`-- ${name}`);
  console.log(`  hit rate of regular requests: ${pct(allHits, allAsked)}% overall; before the scan ${pct(hits[0], asked[0])}%, during it ${pct(hits[1], asked[1])}%, last stretch ${pct(hits[3], asked[3])}%`);
  console.log(`  database reads: ${dbReads} of ${REQUESTS} requests, evictions ${evictions}, expired ${expired}`);
  console.log(`  entries: ${count} at the end, ${peak} at most; out-of-memory restarts ${restarts}`);
  if (policy !== 'none' && peak > size) throw new Error('cache grew past its size');
}

const base = { policy: 'lru', size: 2000, scan: false, shift: false, ttl: 0 };
run('unbounded map, no eviction', { ...base, policy: 'none' });
run('FIFO, 2,000 entries', { ...base, policy: 'fifo' });
run('LRU, 2,000 entries', base);
run('LRU, 2,000 entries, report scan', { ...base, scan: true });
run('LFU, 2,000 entries, report scan', { ...base, policy: 'lfu', scan: true });
run('LFU, 1,000 entries, report scan, hot set moves', { ...base, policy: 'lfu', size: 1000, scan: true, shift: true });
run('LRU, 1,000 entries, report scan, hot set moves', { ...base, size: 1000, scan: true, shift: true });
run('LRU, 2,000 entries, entries expire after 2,000 requests', { ...base, ttl: 2000 });
