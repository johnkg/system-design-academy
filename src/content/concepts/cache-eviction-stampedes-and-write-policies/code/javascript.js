// An LRU cache and a coalescing loader. Time is counted in whole ticks so every run prints the same.
const CAPACITY = 3;              // entries the LRU cache holds
const LOAD_TICKS = 3;            // a database load takes 3 ticks to finish
const FIRST_TICK = 60;           // the hot key has just expired at this tick
const LAST_TICK = 64;            // the demo stops after this tick
const REQUESTS_PER_TICK = 5;     // requests for the hot key in each tick

// Least recently used: a Map remembers insertion order, so the first key is the oldest.
class LruCache {
  constructor(capacity) { this.capacity = capacity; this.items = new Map(); }
  get(key) {
    if (!this.items.has(key)) return undefined;
    const value = this.items.get(key);
    this.items.delete(key);        // re-insert so the key becomes the most recently used
    this.items.set(key, value);
    return value;
  }
  put(key, value) {                // returns the key it evicted, or null
    let evicted = null;
    if (this.items.has(key)) this.items.delete(key);
    else if (this.items.size >= this.capacity) {
      evicted = this.items.keys().next().value;
      this.items.delete(evicted);
    }
    this.items.set(key, value);
    return evicted;
  }
  keys() { return [...this.items.keys()]; }
}

// Part 1: LRU in action.
const lru = new LruCache(CAPACITY);
let hits = 0, misses = 0;
for (const key of ["A", "B", "C", "A", "D", "B", "A", "E"]) {
  if (lru.get(key) !== undefined) { hits++; console.log(`get ${key}: hit`); continue; }
  misses++;
  const evicted = lru.put(key, "value of " + key);
  console.log(`get ${key}: miss` + (evicted ? `, evicts ${evicted}` : ""));
}
console.log(`oldest to newest: ${lru.keys().join(" ")}`);
console.log(`hits ${hits}, misses ${misses}`);

// Part 2: the loader. With coalescing on, requests for a key that is already being loaded
// join that load instead of starting their own.
class Loader {
  constructor(coalesce) {
    this.cache = new LruCache(CAPACITY);
    this.coalesce = coalesce;
    this.inFlight = [];            // database loads under way: { key, readyAt }
    this.dbLoads = 0; this.hits = 0; this.joined = 0;
  }
  finishLoads(now) {
    for (const load of this.inFlight) if (load.readyAt <= now) this.cache.put(load.key, "fresh");
    this.inFlight = this.inFlight.filter((load) => load.readyAt > now);
  }
  request(key, now) {
    if (this.cache.get(key) !== undefined) { this.hits++; return; }
    if (this.coalesce && this.inFlight.some((load) => load.key === key)) { this.joined++; return; }
    this.dbLoads++;
    this.inFlight.push({ key, readyAt: now + LOAD_TICKS });
  }
}

for (const coalesce of [false, true]) {
  const loader = new Loader(coalesce);
  let total = 0;
  for (let tick = FIRST_TICK; tick <= LAST_TICK; tick++) {
    loader.finishLoads(tick);
    for (let i = 0; i < REQUESTS_PER_TICK; i++) { loader.request("home", tick); total++; }
  }
  console.log(`coalescing ${coalesce ? "on " : "off"}: ${total} requests, ${loader.dbLoads} database loads, ${loader.joined} joined, ${loader.hits} hits`);
}
