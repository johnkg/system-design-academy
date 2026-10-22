// A gateway fleet's two safety valves, in JavaScript:
// 1) a per-consumer rate limit counted by several instances, exact or approximate, and 2) a retry budget.

const LIMIT = 1000; // requests per second allowed for each consumer
const SEED = 7, RETRY_SEED = 99;
const TICKS = 100, SYNC_EVERY = 10; // one second of 10 ms ticks; sync every 100 ms
const ABUSER_RATE = 30, GOOD_RATE = 9; // requests per tick
const INSTANCES = 8, WIDE_INSTANCES = 32;
const REQUESTS = 1000, MAX_TRIES = 4, RETRY_COST = 10, TOKEN_CAP = 200; // 1 try + 3 retries; a retry costs 10 tokens
const FAIL_PERCENT = 60;
let seed = SEED;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

// One second in 100 ticks of 10 ms. The abuser sends 30 requests a tick (3,000 a second), a well-behaved consumer 9 (900 a second).
// The load balancer sends every request to a random instance. Returns how many requests were admitted.
function simulate(mode, instances) {
  seed = SEED;
  const consumers = [{ rate: ABUSER_RATE, local: Array(instances).fill(0), seen: Array(instances).fill(0), shared: 0, admitted: 0 },
                     { rate: GOOD_RATE, local: Array(instances).fill(0), seen: Array(instances).fill(0), shared: 0, admitted: 0 }];
  const share = Math.floor(LIMIT / instances);
  for (let tick = 0; tick < TICKS; tick++) {
    for (const c of consumers) {
      if (mode === 'sync' && tick % SYNC_EVERY === 0) { // every 100 ms each instance reports its count and reads the total
        for (let i = 0; i < instances; i++) { c.shared += c.local[i]; c.local[i] = 0; }
        c.seen.fill(c.shared);
      }
      for (let r = 0; r < c.rate; r++) {
        const i = random(instances);
        let ok;
        if (mode === 'central') ok = c.shared < LIMIT;                  // one atomic counter in the shared store
        else if (mode === 'local') ok = c.local[i] < LIMIT;             // every instance enforces the whole limit alone
        else if (mode === 'split') ok = c.local[i] < share;             // every instance gets an equal share
        else ok = c.seen[i] + c.local[i] < LIMIT;                       // sync: the last known total plus what I added since
        if (!ok) continue;
        if (mode === 'central') c.shared++; else c.local[i]++;
        c.admitted++;
      }
    }
  }
  return { abuser: consumers[0].admitted, wronglyRejected: GOOD_RATE * TICKS - consumers[1].admitted };
}

// Retries: a failed attempt is retried up to 3 times. With a budget, a retry costs 10 tokens and every request earns 1 token, so retries stay under 10% of requests.
function retries(failPercent, budget) {
  seed = RETRY_SEED;
  let attempts = 0, succeeded = 0, tokens = 0;
  for (let request = 0; request < REQUESTS; request++) {
    tokens = Math.min(tokens + 1, TOKEN_CAP);
    for (let tries = 0; tries < MAX_TRIES; tries++) {
      if (tries > 0) { if (budget) { if (tokens < RETRY_COST) break; tokens -= RETRY_COST; } }
      attempts++;
      if (random(100) >= failPercent) { succeeded++; break; }
    }
  }
  return { attempts, succeeded };
}

const results = {};
for (const mode of ['central', 'local', 'split', 'sync']) {
  results[mode] = simulate(mode, INSTANCES);
  console.log(`${mode.padEnd(7)} 8 instances: abuser admitted ${results[mode].abuser} of 3000 (limit ${LIMIT}), well-behaved consumer wrongly rejected ${results[mode].wronglyRejected}`);
}
const wide = simulate('split', WIDE_INSTANCES);
console.log(`split   32 instances: abuser admitted ${wide.abuser}, well-behaved consumer wrongly rejected ${wide.wronglyRejected}`);

const unlimited = retries(FAIL_PERCENT, false), budgeted = retries(FAIL_PERCENT, true);
console.log(`upstream failing 60%: unlimited retries send ${unlimited.attempts} attempts (${unlimited.succeeded} ok), budget sends ${budgeted.attempts} attempts (${budgeted.succeeded} ok)`);

const ok = results.central.abuser === LIMIT && results.central.wronglyRejected === 0
  && results.local.abuser === ABUSER_RATE * TICKS                                  // a limit enforced per instance is no limit
  && results.split.abuser <= LIMIT && wide.wronglyRejected > 0       // an even split is safe, but rejects good traffic when counts are uneven
  && results.sync.abuser > LIMIT && results.sync.abuser <= LIMIT + ABUSER_RATE * SYNC_EVERY // sync overshoots by about one interval of traffic
  && results.sync.wronglyRejected === 0
  && budgeted.attempts <= REQUESTS + REQUESTS / RETRY_COST && unlimited.attempts > 2 * REQUESTS;
if (!ok) process.exit(1);
