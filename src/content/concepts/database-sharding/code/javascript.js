// Sharding in JavaScript: route keys to shards by hash, and measure what resharding costs.

function hash(text) { // FNV-1a: a small, stable hash (the same result in every language)
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

const shardFor = (userId, shardCount) => hash(`user:${userId}`) % shardCount;

class ShardedStore {
  constructor(shardCount) {
    this.shards = Array.from({ length: shardCount }, () => new Map()); // one small "database" per shard
  }
  put(userId, user) { this.shards[shardFor(userId, this.shards.length)].set(userId, user); }
  get(userId) { return this.shards[shardFor(userId, this.shards.length)].get(userId); } // touches ONE shard
  countWhere(predicate) { // no shard key in the query: ask every shard and merge (scatter-gather)
    return this.shards.reduce((sum, shard) => sum + [...shard.values()].filter(predicate).length, 0);
  }
}

const store = new ShardedStore(3);
for (let id = 1; id <= 1000; id++) store.put(id, { id, country: id % 4 === 0 ? "FR" : "US" });

console.log("rows per shard:", store.shards.map((s) => s.size).join(", "));
console.log("user 42 is on shard", shardFor(42, 3), "->", store.get(42).country);
console.log("users in FR (scatter-gather):", store.countWhere((u) => u.country === "FR"));

let moved = 0;
for (let id = 1; id <= 1000; id++) if (shardFor(id, 3) !== shardFor(id, 4)) moved++;
console.log(`going from 3 to 4 shards moves ${moved / 10}% of keys`);
