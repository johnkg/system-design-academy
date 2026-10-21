// Caching in JavaScript: an LRU cache with cache-aside reads.

const CACHE_CAPACITY = 2; // entries the cache holds before it evicts

class LruCache {
  #max;
  #entries = new Map(); // a Map remembers insertion order, so the first key is the least recently used

  constructor(max) { this.#max = max; }

  get(key) {
    if (!this.#entries.has(key)) return undefined;
    const value = this.#entries.get(key);
    this.#entries.delete(key);       // re-insert to mark as most recently used
    this.#entries.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.#entries.has(key)) this.#entries.delete(key);
    else if (this.#entries.size >= this.#max) {
      const oldest = this.#entries.keys().next().value;
      this.#entries.delete(oldest);
      console.log(`  evicted ${oldest}`);
    }
    this.#entries.set(key, value);
  }

  delete(key) { this.#entries.delete(key); } // explicit invalidation
}

const database = { reads: 0, load(id) { this.reads++; return `product-${id}`; } };
const cache = new LruCache(CACHE_CAPACITY);
let hits = 0;

function getProduct(id) { // cache-aside: check the cache, fall back to the database, then fill
  const cached = cache.get(id);
  if (cached !== undefined) { hits++; return cached; }
  const row = database.load(id);
  cache.set(id, row);
  return row;
}

for (const id of [1, 2, 1, 3, 1, 2]) getProduct(id);
console.log(`hits: ${hits}, database reads: ${database.reads}`); // hits: 2, database reads: 4
