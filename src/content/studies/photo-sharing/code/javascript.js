// Likes on a viral photo, in JavaScript:
// a unique (post, user) row keeps repeated taps out, the counter is split over shards so no row is hot,
// and writes to the counter are batched, so the database sees a few big additions instead of thousands of small ones.

const SHARDS = 8, BATCH = 500;

class LikeStore {
  constructor() {
    this.liked = new Set();     // the unique (post, user) rows: a repeat is rejected here
    this.shards = new Map();    // post -> counter shards, each one a separate row in the database
    this.pending = new Map();   // "post:shard" -> likes waiting in the buffer
    this.waiting = 0;
    this.counterWrites = 0;     // updates that reached a counter row
    this.rowWrites = new Map(); // "post:shard" -> updates that row received
  }

  like(post, user, pick) {
    const key = post * 100000 + user;
    if (this.liked.has(key)) return false;           // the unique constraint says: already liked
    this.liked.add(key);
    const slot = `${post}:${pick % SHARDS}`;         // any shard will do, so choose by a random number
    this.pending.set(slot, (this.pending.get(slot) ?? 0) + 1);
    if (++this.waiting >= BATCH) this.flush();
    return true;
  }

  flush() {                                          // one update per (post, shard) that changed, however many likes it holds
    for (const [slot, n] of this.pending) {
      const [post, shard] = slot.split(':').map(Number);
      if (!this.shards.has(post)) this.shards.set(post, new Array(SHARDS).fill(0));
      this.shards.get(post)[shard] += n;
      this.counterWrites++;
      this.rowWrites.set(slot, (this.rowWrites.get(slot) ?? 0) + 1);
    }
    this.pending.clear(); this.waiting = 0;
  }

  shown(post) { return (this.shards.get(post) ?? []).reduce((a, b) => a + b, 0); } // the count a reader sees: the sum of the shards
}

let seed = 4242;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

const store = new LikeStore();
const posts = [0, 1, 2];
const sumShown = () => posts.reduce((s, p) => s + store.shown(p), 0);
const taps = [];                                    // every tap, including repeats
let accepted = 0, behindMax = 0;
for (let i = 0; i < 30000; i++) {
  const post = random(10) < 8 ? 0 : 1 + random(2);  // 80% of the taps go to the viral post 0
  const user = random(20000);
  taps.push([post, user]);
  if (store.like(post, user, random(1000))) accepted++;
  behindMax = Math.max(behindMax, accepted - sumShown()); // likes in the buffer, not yet in the counters
}
const lastBehind = accepted - sumShown();
store.flush();

const truth = posts.map((p) => new Set(taps.filter((t) => t[0] === p).map((t) => t[1])).size); // the slow, obvious count
const shown = posts.map((p) => store.shown(p));
console.log(`taps: ${taps.length}, counted once each: ${accepted}, repeats rejected: ${taps.length - accepted}`);
console.log(`true counts: ${truth.join(', ')}; counts after the last flush: ${shown.join(', ')}`);
console.log(`the count trailed by at most ${behindMax} likes, and by ${lastBehind} just before the final flush`);
const hot = [...store.rowWrites].filter(([k]) => k.startsWith('0:')).map(([, n]) => n);
console.log(`counter writes: ${store.counterWrites} instead of ${accepted}; the hottest row got ${Math.max(...hot)}, a single row would have got ${truth[0]}`);

const ok = shown.every((c, i) => c === truth[i]) && accepted === truth.reduce((a, b) => a + b, 0) && store.counterWrites < accepted / 10;
if (!ok) process.exit(1);
