// A miniature of the limiters in Stripe's "Scaling your API with rate limiters" (2017), in JavaScript (a teaching model, not Stripe's code):
// a token bucket per user (request rate), a cap on requests in progress, a fleet load shedder that reserves room for critical
// requests, a dark launch that only logs, and failing open when the limiter's own store breaks. Everything is deterministic.

class TokenBucket {
  constructor(capacity, refill) { this.capacity = capacity; this.refill = refill; this.tokens = capacity; }
  tick() { this.tokens = Math.min(this.capacity, this.tokens + this.refill); }
  take() { if (this.tokens >= 1) { this.tokens -= 1; return true; } return false; }
}

console.log('--- request rate limiter: bucket of 5 tokens, refilled by 2 each second');
const bucket = new TokenBucket(5, 2);
for (const [second, requests] of [[1, 8], [2, 3]]) {
  if (second > 1) bucket.tick();
  let allowed = 0;
  for (let i = 0; i < requests; i++) if (bucket.take()) allowed++;
  console.log(`second ${second}: ${requests} requests -> ${allowed} allowed, ${requests - allowed} rejected with 429`);
}

console.log('--- dark launch: same burst, but the limiter only logs');
const dark = new TokenBucket(5, 2);
let wouldReject = 0;
for (let i = 0; i < 8; i++) if (!dark.take()) wouldReject++;
console.log(`second 1: 8 requests -> 8 allowed, ${wouldReject} would have been rejected (logged, not enforced)`);

console.log('--- concurrent requests limiter: at most 2 in progress per user');
let inProgress = 0;
const start = () => { if (inProgress >= 2) return false; inProgress++; return true; };
const started = [start(), start(), start()];
console.log(`3 slow requests at once -> ${started.filter(Boolean).length} started, ${started.filter((s) => !s).length} rejected with 429`);
inProgress--;
console.log(`one finishes, a new request -> ${start() ? 'started' : 'rejected with 429'}`);

console.log('--- fleet usage load shedder: 10 slots, 20% kept for critical requests');
const SLOTS = 10, RESERVED = 2; // 20% of the slots
let used = 0;
function admit(critical) {
  const limit = critical ? SLOTS : SLOTS - RESERVED; // non-critical traffic may use only 80%
  if (used >= limit) return false;
  used++;
  return true;
}
const nonCritical = Array.from({ length: 9 }, () => admit(false));
console.log(`9 non-critical requests (list charges) -> ${nonCritical.filter(Boolean).length} allowed, ${nonCritical.filter((a) => !a).length} rejected with 503`);
const critical = [admit(true), admit(true), admit(true)];
console.log(`3 critical requests (create charge) -> ${critical.filter(Boolean).length} allowed, ${critical.filter((a) => !a).length} rejected with 503`);

console.log("--- the limiter's own store fails");
function checkWithStore(storeUp) {
  try {
    if (!storeUp) throw new Error('store unreachable');
    return 'checked normally';
  } catch (e) {
    return `limiter error (${e.message}), failing open: request allowed`;
  }
}
console.log(`store up -> ${checkWithStore(true)}`);
console.log(`store down -> ${checkWithStore(false)}`);
