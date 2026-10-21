// A skill-based matchmaking queue in JavaScript:
// every waiting player has a search window around their rating that widens each second, and two players match
// when their rating gap fits inside both windows. We compare a fixed window with a widening one.

const SEED = 7, MIN_RATING = 400, DIE_SIDES = 600; // a rating is 400 plus three draws of 0..599
const PLAYERS = 600, DRAIN_SECONDS = 120; // one player joins per second, then the queue drains
let seed = SEED;
// Linear congruential generator (Numerical Recipes constants), high 16 bits.
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

// Ratings come from the sum of three dice, so most players are near the middle and a few are far out.
const makeRatings = (count) => Array.from({ length: count }, () => MIN_RATING + random(DIE_SIDES) + random(DIE_SIDES) + random(DIE_SIDES));

// The window is the base plus a step for each second waited, up to a cap. A step of 0 gives a fixed window.
const windowOf = (policy, waited) => Math.min(policy.cap, policy.base + policy.step * waited);

function simulate(policy, ratings, arrivalSeconds, drainSeconds) {
  let queue = [];                                   // waiting tickets, oldest first
  const stats = { matched: 0, gapSum: 0, waitSum: 0, maxWait: 0 };
  for (let now = 0; now < arrivalSeconds + drainSeconds; now++) {
    if (now < arrivalSeconds) queue.push({ id: now, rating: ratings[now], since: now }); // one player joins each second
    const taken = new Set();
    for (const a of queue) {                        // oldest first, so nobody waits behind a newcomer
      if (taken.has(a.id)) continue;
      const wa = windowOf(policy, now - a.since);
      let best = null;
      for (const b of queue) {
        if (b.id === a.id || taken.has(b.id)) continue;
        const gap = Math.abs(a.rating - b.rating);
        const fits = gap <= wa && gap <= windowOf(policy, now - b.since); // both players must accept the gap
        if (fits && (best === null || gap < best.gap)) best = { b, gap };
      }
      if (best === null) continue;
      taken.add(a.id); taken.add(best.b.id);
      const waits = [now - a.since, now - best.b.since];
      stats.matched += 1; stats.gapSum += best.gap; stats.waitSum += waits[0] + waits[1];
      stats.maxWait = Math.max(stats.maxWait, ...waits);
      if (best.gap > Math.min(windowOf(policy, waits[0]), windowOf(policy, waits[1]))) throw new Error('gap outside a window');
    }
    queue = queue.filter((t) => !taken.has(t.id));
  }
  return { ...stats, left: queue.length };
}

// How wide the widening window is after a few waits, so the reader can see the schedule.
const schedule = (policy) => [0, 5, 20, 40].map((w) => `${w}s:${windowOf(policy, w)}`).join(' ');

const ratings = makeRatings(PLAYERS);
const policies = [
  { name: 'fixed', base: 25, step: 0, cap: 25 },
  { name: 'widening', base: 25, step: 10, cap: 400 },
];
const results = policies.map((p) => ({ p, r: simulate(p, ratings, PLAYERS, DRAIN_SECONDS) }));
for (const { p, r } of results) {
  const avgGap = Math.floor(r.gapSum / r.matched);
  const avgWait = Math.floor(r.waitSum / (2 * r.matched));
  console.log(`${p.name}: ${r.matched} matches, ${r.left} players left, average gap ${avgGap}, average wait ${avgWait}s, longest wait ${r.maxWait}s`);
}
console.log(`widening window by wait: ${schedule(policies[1])}`);
const [fixed, widening] = results.map((x) => x.r);
console.log(`widening finds ${widening.matched - fixed.matched} more matches and leaves ${fixed.left - widening.left} fewer players waiting`);
if (2 * widening.matched + widening.left !== PLAYERS || 2 * fixed.matched + fixed.left !== PLAYERS) process.exit(1);
if (widening.matched <= fixed.matched || fixed.maxWait < widening.maxWait) process.exit(1);
