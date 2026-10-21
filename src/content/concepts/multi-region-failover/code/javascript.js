// Simulate losing region A while region B holds a standby copy. Integer milliseconds and a seeded
// generator make the run reproducible. It measures RTO (downtime), RPO (acknowledged writes lost
// to replication lag) and the split-brain writes the old primary accepts when it comes back.

const FAIL_AT = 25000, CLIENTS = 100, SYNC_RTT = 80, BACK_AFTER_PROMOTE = 15000;
const SEED = 42;
const HORIZON_SLACK_MS = 1000; // keep simulating this long after the last client recovers
const WRITE_GAP_MIN_MS = 50; // writes arrive every 50..149 ms (about 10 per second)
const WRITE_GAP_SPREAD_MS = 100;
const LAG_MIN_PCT = 50; // each write's replication lag is 50..149% of lagMs
const LAG_SPREAD_PCT = 100;

// Park-Miller (MINSTD) generator
function makeRng(seed) { let x = seed; return (n) => { x = (x * 48271) % 2147483647; return x % n; }; }

// A fencing token authority: every promotion bumps the epoch, and storage rejects older epochs.
class Fence {
  constructor(promoteAt) { this.promoteAt = promoteAt; }
  epochAt(t) { return t >= this.promoteAt ? 2 : 1; }
  accepts(writerEpoch, t) { return writerEpoch >= this.epochAt(t); }
}

function simulate({ sync, lagMs, ttlMs, intervalMs, threshold, promoteMs, fencing }) {
  const rng = makeRng(SEED);
  // 1. Failure detection: health checks run every interval; N consecutive failures declare A dead.
  const firstBadCheck = Math.ceil(FAIL_AT / intervalMs) * intervalMs;
  const detectAt = firstBadCheck + (threshold - 1) * intervalMs;
  // 2. Promotion: the standby is started or scaled up and made writable (epoch 1 -> 2), then DNS flips.
  const promoteAt = detectAt + promoteMs;
  const fence = new Fence(promoteAt);
  const backAt = promoteAt + BACK_AFTER_PROMOTE;
  // 3. Each client cached the old DNS answer at some random moment, so it keeps using A until its TTL ends.
  const recoverAt = [];
  for (let c = 0; c < CLIENTS; c++) recoverAt.push(promoteAt + rng(ttlMs));
  const horizon = Math.max(...recoverAt) + HORIZON_SLACK_MS;
  // 4. A seeded write stream (about 10 per second), replicated to B in order after a random lag.
  let t = 0, applied = 0, acked = 0, lost = 0, oldestLost = -1;
  let failed = 0, fenced = 0, diverged = 0;
  for (;;) {
    t += WRITE_GAP_MIN_MS + rng(WRITE_GAP_SPREAD_MS);
    if (t >= horizon) break;
    const client = rng(CLIENTS);
    const lag = Math.floor((lagMs * (LAG_MIN_PCT + rng(LAG_SPREAD_PCT))) / 100);
    if (t < FAIL_AT) {
      if (sync && t + SYNC_RTT > FAIL_AT) { failed++; continue; } // never acknowledged: the client retries
      acked++;
      applied = Math.max(applied, t + (sync ? SYNC_RTT : lag)); // in-order apply on B
      if (!sync && applied > FAIL_AT) { lost++; if (oldestLost < 0) oldestLost = t; }
    } else if (t < recoverAt[client]) { // this client still resolves to A
      if (t < backAt) failed++;                    // A is down
      else if (!fencing || fence.accepts(1, t)) diverged++; // A is back, still thinks it is primary
      else fenced++;                                // the stale epoch is rejected
    }
  }
  const sorted = [...recoverAt].sort((a, b) => a - b);
  return { detectAt, promoteAt, backAt, acked, lost, rpoMs: oldestLost < 0 ? 0 : FAIL_AT - oldestLost,
    rtoMs: sorted[CLIENTS - 1] - FAIL_AT, p50Ms: sorted[CLIENTS / 2] - FAIL_AT, failed, fenced, diverged };
}

const base = { sync: false, lagMs: 500, ttlMs: 60000, intervalMs: 10000, threshold: 3, promoteMs: 45000, fencing: false };
const scenarios = [
  ["async, warm standby, no fencing", base],
  ["async, warm standby, fencing", { ...base, fencing: true }],
  ["sync replication, fencing", { ...base, sync: true, fencing: true }],
  ["fast config: hot standby, TTL 5s, 5s checks x2", { ...base, ttlMs: 5000, intervalMs: 5000, threshold: 2, promoteMs: 2000, fencing: true }],
];
const out = scenarios.map(([name, p]) => ({ name, r: simulate(p) }));
for (const { name, r } of out) {
  console.log(name);
  console.log(`  detected at ${r.detectAt}ms, promoted at ${r.promoteAt}ms, old region back at ${r.backAt}ms`);
  console.log(`  RTO all clients ${r.rtoMs}ms, half of clients ${r.p50Ms}ms`);
  console.log(`  RPO: ${r.lost} of ${r.acked} acked writes lost, window ${r.rpoMs}ms`);
  console.log(`  writes rejected ${r.failed}, fenced ${r.fenced}, split-brain ${r.diverged}`);
}

const [a, b, s, f] = out.map((o) => o.r);
const fence = new Fence(100);
if (!(fence.accepts(1, 99) && !fence.accepts(1, 100) && fence.accepts(2, 100))) process.exit(1);
const ok = a.diverged > 0 && b.diverged === 0 && b.fenced === a.diverged && a.lost === b.lost && a.lost > 0
  && s.lost === 0 && s.rpoMs === 0 && f.rtoMs < a.rtoMs && a.rtoMs >= a.promoteAt - FAIL_AT;
console.log(`invariants hold: ${ok}`);
if (!ok) process.exit(1);
