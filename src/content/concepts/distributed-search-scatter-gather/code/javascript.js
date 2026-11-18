// Scatter and gather: a coordinator sends a query to every shard, each shard returns its own top (from + size) results,
// and the coordinator merges them. The query is as slow as its slowest shard. 2,000 simulated queries with a seeded
// random generator, integer milliseconds, so the output never changes.
const QUERIES = 2000;
const BASE_MS = 20;        // a shard answers in about this long when nothing goes wrong
const SLOW_PER_MILLE = 5;   // chance (in 1,000) that one shard request is slow (0.5%) (a garbage-collection pause, a busy disk)
const SLOW_MS = 200;       // how much longer a slow request takes
const BIG_SHARD = 3;       // with uneven shards, shard 0 holds this many times the data and takes this many times as long

function makeRandom(seed) {   // Park-Miller generator: small enough that every language computes it exactly
  let x = seed;
  return (n) => { x = (x * 48271) % 2147483647; return x % n; };
}

// One shard request: base time (more for a bigger shard), a random spread, a rare slow spike, and the cost of collecting from + size hits.
function shardTime(rand, base, spread, depth) {
  return base + rand(spread + 1) + (rand(1000) < SLOW_PER_MILLE ? SLOW_MS : 0) + Math.floor(depth / 100);
}

function run({ shards, replicas, hedge, spread, from, size, uneven }) {
  const rand = makeRandom(12345);
  const depth = from + size;
  const merge = 2 + Math.floor(shards * depth / 1000);   // the coordinator merges shards x (from + size) hits
  const times = [];
  let slowQueries = 0;
  for (let q = 0; q < QUERIES; q++) {
    let worst = 0, hitSlow = false;
    for (let s = 0; s < shards; s++) {
      const base = uneven && s === 0 ? BASE_MS * BIG_SHARD : BASE_MS;
      const a = shardTime(rand, base, spread, depth);
      const b = shardTime(rand, base, spread, depth);   // the second replica is always drawn, so settings are compared on the same luck
      const t = hedge && replicas >= 2 ? Math.min(a, b) : a;
      if (t >= base + SLOW_MS) hitSlow = true;
      worst = Math.max(worst, t);
    }
    if (hitSlow) slowQueries++;
    times.push(worst + merge);
  }
  times.sort((x, y) => x - y);
  return {
    p50: times[Math.floor(QUERIES * 50 / 100)], p99: times[Math.floor(QUERIES * 99 / 100)],
    slowTenths: Math.floor(slowQueries * 1000 / QUERIES), moved: shards * depth, kept: size,
  };
}

const base = { shards: 8, replicas: 1, hedge: false, spread: 10, from: 0, size: 10, uneven: false };
const show = (name, o) => {
  const r = run({ ...base, ...o });
  console.log(`${name}: p50 ${r.p50} ms, p99 ${r.p99} ms, ${Math.floor(r.slowTenths / 10)}.${r.slowTenths % 10}% of queries hit a slow shard, ${r.moved} documents sent to the coordinator for ${r.kept} shown`);
  return r;
};
console.log('how the slowest shard decides the query (spread 10 ms, first page)');
const one = show('1 shard   ', { shards: 1 });
show('8 shards  ', {});
const wide = show('32 shards ', { shards: 32 });
console.log('send each request to two replicas and use the first answer');
show('8 shards, 2 replicas, hedged', { replicas: 2, hedge: true });
const hedged = show('32 shards, 2 replicas, hedged', { shards: 32, replicas: 2, hedge: true });
console.log('deep pagination, 8 shards (size 10)');
show('from 0     ', {});
show('from 1000  ', { from: 1000 });
const deep = show('from 10000 ', { from: 10000 });
console.log('uneven shards: shard 0 holds 3 times the data');
const uneven = show('8 shards, one big shard', { uneven: true });
if (wide.p99 <= one.p99 || hedged.p99 >= wide.p99 || deep.moved !== 80080 || uneven.p50 <= 60) throw new Error('impossible result');
