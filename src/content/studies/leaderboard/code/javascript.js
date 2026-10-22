// A leaderboard split over several shards, in JavaScript:
// each shard keeps its players sorted, the top list is a merge of every shard's top list, and a player's rank is a sum of counts.

// Better means a higher score, and when scores are equal, the lower player id (who got there first).
const better = (a, b) => a.score > b.score || (a.score === b.score && a.id < b.id);

class Shard {
  constructor() { this.sorted = []; this.scoreOf = new Map(); } // sorted: best first

  // Number of entries in this shard that are better than the given one (binary search, so it is fast with millions of entries).
  countBetter(entry) {
    let lo = 0, hi = this.sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (better(this.sorted[mid], entry)) lo = mid + 1; else hi = mid; }
    return lo;
  }

  update(id, score) {
    if (this.scoreOf.has(id)) this.sorted.splice(this.countBetter({ id, score: this.scoreOf.get(id) }), 1); // remove the old entry
    this.scoreOf.set(id, score);
    this.sorted.splice(this.countBetter({ id, score }), 0, { id, score });                                  // insert in its place
  }

  top(k) { return this.sorted.slice(0, k); }
}

class Leaderboard {
  constructor(shardCount) { this.shards = Array.from({ length: shardCount }, () => new Shard()); }
  shardOf(id) { return this.shards[(Math.imul(id, 2654435761) >>> 16) % this.shards.length]; } // the high bits of the product are well mixed
  update(id, score) { this.shardOf(id).update(id, score); }

  // The best k overall must be among the best k of some shard, so asking each shard for k is enough.
  top(k) {
    return this.shards.flatMap((s) => s.top(k)).sort((a, b) => (better(a, b) ? -1 : 1)).slice(0, k);
  }

  rank(id) {
    const entry = { id, score: this.shardOf(id).scoreOf.get(id) };
    return 1 + this.shards.reduce((sum, s) => sum + s.countBetter(entry), 0);
  }
}

const SEED = 2024, SHARDS = 5;
const UPDATES = 20000, PLAYERS = 2000, MAX_SCORE = 1000;
const TOP_N = 5, CHECKED_TOP = 100, PROBE_INDEX = 1234, SPOT_CHECK_EVERY = 97;
let seed = SEED;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

const board = new Leaderboard(SHARDS);
const truth = new Map(); // the same scores kept the slow, obvious way, to check against
for (let i = 0; i < UPDATES; i++) { // 20,000 updates to 2,000 players, so most players are updated many times
  const id = random(PLAYERS), score = random(MAX_SCORE);
  board.update(id, score); truth.set(id, score);
}

const all = [...truth].map(([id, score]) => ({ id, score })).sort((a, b) => (better(a, b) ? -1 : 1));
const top = board.top(TOP_N);
console.log(`top 5: ${top.map((e) => `#${e.id} (${e.score})`).join(', ')}`);
const probe = all[PROBE_INDEX].id;
console.log(`player #${probe} has score ${truth.get(probe)} and rank ${board.rank(probe)}; the full sort says ${PROBE_INDEX + 1}`);

const sameTop = JSON.stringify(board.top(CHECKED_TOP)) === JSON.stringify(all.slice(0, CHECKED_TOP));
const sameRank = all.every((e, i) => i % SPOT_CHECK_EVERY !== 0 || board.rank(e.id) === i + 1); // spot-check every 97th player
console.log(`top 100 matches the full sort: ${sameTop}; ranks match: ${sameRank}`);
if (!sameTop || !sameRank || board.rank(probe) !== PROBE_INDEX + 1) process.exit(1);
