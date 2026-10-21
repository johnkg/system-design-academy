// A moderation pipeline in JavaScript: a perceptual-hash lookup, then a three-way triage by classifier score,
// then a review queue that is served most-suspicious first and has limited reviewer capacity.
const SEED = 2024;
const HALF_WORD = 65536, HASH_BITS = 32; // a 32-bit hash is built from two 16-bit halves
const UPLOADS = 3000, HARMFUL_PERCENT = 6, SCORE_SCALE = 1000;
const KNOWN_BAD = 40, EDITED_COPY_PERCENT = 40, MAX_FLIPS = 4; // an edited copy has 0..3 bits flipped
let seed = SEED;
// Linear congruential generator (Numerical Recipes constants).
const next = () => (seed = (seed * 1664525 + 1013904223) % 4294967296);
const random = (n) => Math.floor(next() / 65536) % n; // the high 16 bits are the better ones
const hash32 = () => random(HALF_WORD) * HALF_WORD + random(HALF_WORD);
const popcount = (x) => { let c = 0; while (x > 0) { c += x % 2; x = Math.floor(x / 2); } return c; };
const distance = (a, b) => popcount((a ^ b) >>> 0);

const HI = 950, LO = 200, MAX_DISTANCE = 4, CAPACITY = 100; // scores are in thousandths

// Build 3,000 uploads. A harmful upload scores high and a harmless one scores low, with an overlap in the middle.
const known = [];
const uploads = [];
for (let id = 0; id < UPLOADS; id++) {
  const harmful = random(100) < HARMFUL_PERCENT;
  const score = harmful
    ? SCORE_SCALE - Math.floor((random(SCORE_SCALE) * random(SCORE_SCALE)) / SCORE_SCALE)
    : Math.floor((random(SCORE_SCALE) * random(SCORE_SCALE) * random(SCORE_SCALE)) / (SCORE_SCALE * SCORE_SCALE));
  let hash = hash32();
  if (harmful && known.length < KNOWN_BAD) known.push(hash); // the first harmful uploads become the known-bad list
  else if (harmful && random(100) < EDITED_COPY_PERCENT) { // a later harmful upload may be an edited copy of a known one
    hash = known[random(known.length)];
    for (let i = random(MAX_FLIPS); i > 0; i--) hash = (hash ^ (1 << random(HASH_BITS))) >>> 0; // flip up to 3 bits
  }
  uploads.push({ id, harmful, score, hash });
}

const fate = { hashBlocked: [], removed: [], published: [], queued: [] };
for (const u of uploads) {
  if (known.some((k) => distance(k, u.hash) <= MAX_DISTANCE)) fate.hashBlocked.push(u);
  else if (u.score >= HI) fate.removed.push(u);
  else if (u.score < LO) fate.published.push(u);
  else fate.queued.push(u);
}

// The most suspicious first, and the lower id first when scores are equal. A reviewer is assumed to judge correctly.
fate.queued.sort((a, b) => b.score - a.score || a.id - b.id);
const reviewed = fate.queued.slice(0, CAPACITY);
const overflow = fate.queued.slice(CAPACITY); // published unreviewed after the deadline
const reviewRemoved = reviewed.filter((u) => u.harmful);

const count = (list) => list.filter((u) => u.harmful).length;
const wrong = (list) => list.length - count(list);
const missed = count(fate.published) + count(overflow);
const totalHarmful = count(uploads);
const removedTotal = fate.hashBlocked.length + fate.removed.length + reviewRemoved.length;
const removedRight = count(fate.hashBlocked) + count(fate.removed) + reviewRemoved.length;

console.log(`${totalHarmful} harmful uploads out of ${uploads.length}, ${known.length} of them on the known-bad list`);
console.log(`hash match: ${fate.hashBlocked.length} blocked, ${wrong(fate.hashBlocked)} by mistake`);
console.log(`auto-removed: ${fate.removed.length}, of which ${wrong(fate.removed)} were harmless`);
console.log(`auto-published: ${fate.published.length}, of which ${count(fate.published)} were harmful`);
console.log(`review: ${fate.queued.length} queued, ${reviewed.length} reviewed (lowest score reviewed ${reviewed[reviewed.length - 1].score}), ${overflow.length} published unreviewed`);
console.log(`missed harm: ${missed}; precision ${Math.floor((100 * removedRight) / removedTotal)}%, recall ${Math.floor((100 * removedRight) / totalHarmful)}%`);

const everyone = fate.hashBlocked.length + fate.removed.length + fate.published.length + fate.queued.length;
const ordered = reviewed.every((u) => overflow.every((o) => u.score >= o.score));
if (everyone !== uploads.length || !ordered || wrong(reviewed) + count(reviewed) !== CAPACITY) process.exit(1);
