// A request fans through A -> B -> C -> database on a virtual clock (milliseconds, no real waiting).
// The user waits 2000 ms. The database is sometimes slow. We compare three policies and count work
// that keeps running after its caller gave up ("orphans"). Cancellation is OFF: nothing tells a callee
// that its caller left, so only a hop that checks the deadline itself can stop.

const USER = 2000, GAP = 50, N = 200, SLOW_PERMILLE = 100, ATTEMPT = 400, BACKOFF = 25, RETRIES = 2;
const PRE = 10, POST = 5, MIN_LEFT = 50, RETRY_MIN = 100;
const SEED = 12345;
const SLOW_MIN = 2500, SLOW_SPREAD = 6500, FAST_MIN = 20, FAST_SPREAD = 60; // database attempt latency (ms)

let seed = SEED; // Park-Miller generator, integers only so every language prints the same
const next = () => (seed = (seed * 48271) % 2147483647);

// timeouts[0] = A waits on B, [1] = B waits on C, [2] = C waits on the database per attempt
const POLICIES = {
  "fixed 5 s everywhere": { timeouts: [5000, 5000, 5000], deadline: false },
  "fixed, tuned 1.8/1.2/0.4": { timeouts: [1800, 1200, ATTEMPT], deadline: false },
  "propagated deadline": { timeouts: [0, 0, ATTEMPT], deadline: true },
};

function simulate(policy, t0, attempts) {
  const D = t0 + USER, spans = []; // spans: {hop, start, end, callerLeft}
  function run(hop, start) {
    const span = { hop, start, end: start, callerLeft: Infinity, ok: false };
    spans.push(span);
    // Deadline mode: every hop enforces the absolute deadline itself and fails fast when little is left.
    const cutoff = policy.deadline ? D : Infinity;
    if (policy.deadline && D - start < MIN_LEFT) return span;
    let t = start + PRE, ok = false;
    if (t > cutoff) { span.end = cutoff; return span; }
    if (hop < 2) {
      const giveUp = Math.min(policy.deadline ? D : t + policy.timeouts[hop], cutoff);
      const child = run(hop + 1, t);
      if (child.ok && child.end <= giveUp) { ok = true; t = child.end; }
      else { if (child.end > giveUp) child.callerLeft = giveUp; t = Math.min(child.end, giveUp); }
    } else {
      for (let i = 0; i <= RETRIES; i++) {
        const giveUp = Math.min(t + policy.timeouts[2], cutoff);
        const natural = t + attempts[i]; // when the database would really finish
        const db = { hop: 3, start: t, end: Math.min(natural, policy.deadline ? giveUp : Infinity), callerLeft: Infinity, ok: false };
        spans.push(db);
        if (natural <= giveUp) { db.ok = ok = true; t = natural; break; }
        db.callerLeft = giveUp; t = giveUp;
        if (i === RETRIES || t >= cutoff) break;
        if (policy.deadline && D - t - BACKOFF < RETRY_MIN) break; // the retry would not fit in the budget
        t += BACKOFF;
      }
    }
    if (ok) { if (t + POST > cutoff) { t = cutoff; ok = false; } else t += POST; }
    span.end = t; span.ok = ok;
    return span;
  }
  const top = run(0, t0);
  if (top.end > D) top.callerLeft = D;
  return { spans, D, good: top.ok && top.end <= D };
}

const requests = [];
for (let i = 0; i < N; i++) {
  const attempts = [];
  for (let k = 0; k < RETRIES + 1; k++) { const s = next(), a = next(); attempts.push(s % 1000 < SLOW_PERMILLE ? SLOW_MIN + (a % SLOW_SPREAD) : FAST_MIN + (a % FAST_SPREAD)); }
  requests.push({ t0: i * GAP, attempts });
}

const summary = {};
for (const [name, policy] of Object.entries(POLICIES)) {
  let good = 0, orphanCalls = 0, orphanMs = 0, afterDeadline = 0;
  for (const r of requests) {
    const res = simulate(policy, r.t0, r.attempts);
    if (res.good) good++;
    for (const s of res.spans) {
      const o = Math.max(0, s.end - s.callerLeft);
      if (o > 0) { orphanCalls++; orphanMs += o; }
      if (s.end > res.D) afterDeadline++;
    }
  }
  summary[name] = { good, orphanCalls, orphanMs, afterDeadline };
  console.log(`${name.padEnd(26)} within 2 s: ${good}/${N}  orphan calls: ${orphanCalls}  orphan time: ${orphanMs} ms  work after deadline: ${afterDeadline}`);
}

const dl = summary["propagated deadline"], fixed = summary["fixed 5 s everywhere"];
// Invariants: a hop that enforces the deadline never works past it and never leaves an orphan.
const violations = [
  [dl.afterDeadline !== 0 || dl.orphanCalls !== 0, "deadline mode worked past the deadline"],
  [fixed.orphanCalls === 0, "fixed 5 s timeouts should leave orphans"],
  [dl.good < fixed.good, "the deadline policy should never succeed less often"],
].filter(([bad]) => bad);
if (violations.length) { console.log(violations.map((v) => v[1]).join("; ")); process.exit(1); }
console.log("deadline propagation did no work after the deadline");
