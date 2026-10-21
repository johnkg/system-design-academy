// RED and USE summaries from a seeded event stream, and a rule that names the failing component.
// Integers only, so JavaScript, C# and Python print exactly the same text.

const DEPS = ["payments", "inventory", "db"];
const FAULTS = {
  payments_slow: "payments",
  db_lock: "db",
  pool_exhaustion: "checkout db pool",
  bad_deploy: "inventory",
};

const REQUESTS = 400; // checkout requests per period
const SAMPLES = 12; // resource samples per period
const PAY_SLOWDOWN = 12; // payments_slow multiplies payment latency
const BAD_DEPLOY_FAIL_PCT = 25;
const ERR_JUMP_PM = 50; // diagnosis: an error-rate jump (per mille) that marks a bad build
const SLOW_FACTOR = 3; // p99 this many times the healthy p99 is slow
const POOL_WAITERS_ALERT = 10; // mean pool waiters that blame the pool
const SEED = 7;
const CONTROL_SEED = 8; // a second healthy period
// Draws as [minimum, spread]: a value is minimum + (random % spread).
const OWN_MS = [10, 20]; // checkout's own work
const PAY_MS = [40, 40];
const INV_MS = [15, 15];
const DB_MS = [4, 8];
const LOCK_WAIT_MS = [600, 400]; // db_lock: extra time per query
const POOL_WAIT_MS = [500, 500]; // pool_exhaustion: waiting for a connection
const FAST_FAIL_MS = [5, 8]; // bad_deploy: a failed inventory call
const POOL_UTIL_PCT = [30, 15]; // resource samples
const DB_CPU_PCT = [25, 10];
const EXHAUSTED_WAITERS = [20, 10];
const EXHAUSTED_CPU_PCT = [15, 5];
const LOCKED_WAITERS = [10, 10];
const LOCKED_CPU_PCT = [5, 5];

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 8; // 24 bits
  };
}

// One period of 400 checkout requests plus 12 resource samples, with an optional injected fault.
function simulate(fault, seed) {
  const r = lcg(seed);
  const draw = ([min, spread]) => min + (r() % spread);
  const events = []; // { svc, dur, ok }
  for (let i = 0; i < REQUESTS; i++) {
    const own = draw(OWN_MS);
    let pay = draw(PAY_MS), inv = draw(INV_MS), db = draw(DB_MS), pool = 0, ok = true;
    if (fault === "payments_slow") pay *= PAY_SLOWDOWN;
    if (fault === "db_lock") db += draw(LOCK_WAIT_MS);
    if (fault === "pool_exhaustion") pool = draw(POOL_WAIT_MS); // waiting for a connection, not a slow query
    if (fault === "bad_deploy" && r() % 100 < BAD_DEPLOY_FAIL_PCT) { ok = false; inv = draw(FAST_FAIL_MS); }
    if (ok) {
      events.push({ svc: "payments", dur: pay, ok: true }, { svc: "db", dur: db, ok: true });
      events.push({ svc: "inventory", dur: inv, ok: true }, { svc: "checkout", dur: own + pool + pay + inv + db, ok: true });
    } else { // the bad inventory build fails fast and checkout returns 500 straight away
      events.push({ svc: "inventory", dur: inv, ok: false }, { svc: "checkout", dur: own + inv, ok: false });
    }
  }
  const samples = []; // { poolUtil, waiters, runq, cpu }
  for (let i = 0; i < SAMPLES; i++) {
    let poolUtil = draw(POOL_UTIL_PCT), waiters = 0, cpu = draw(DB_CPU_PCT);
    if (fault === "pool_exhaustion") { poolUtil = 100; waiters = draw(EXHAUSTED_WAITERS); cpu = draw(EXHAUSTED_CPU_PCT); } // starved database idles
    if (fault === "db_lock") { poolUtil = 100; waiters = draw(LOCKED_WAITERS); cpu = draw(LOCKED_CPU_PCT); }
    samples.push({ poolUtil, waiters, cpu });
  }
  return { events, samples };
}

const percentile = (sorted, p) => sorted[Math.floor((p * sorted.length + 99) / 100) - 1]; // nearest rank
const mean = (xs) => (xs.length ? Math.floor(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

// RED per service: Rate (calls), Errors (per mille), Duration (p99 of successes, p50 of failures kept apart).
function red(events, svc) {
  const mine = events.filter((e) => e.svc === svc);
  const ok = mine.filter((e) => e.ok).map((e) => e.dur).sort((a, b) => a - b);
  const bad = mine.filter((e) => !e.ok).map((e) => e.dur).sort((a, b) => a - b);
  return {
    rate: mine.length,
    errPm: Math.floor((bad.length * 1000) / mine.length),
    p99: ok.length ? percentile(ok, 99) : 0,
    failP50: bad.length ? percentile(bad, 50) : 0,
    avg: mean(mine.map((e) => e.dur)),
  };
}
// USE for the connection pool and the database host.
const use = (samples) => ({ poolUtil: mean(samples.map((s) => s.poolUtil)), waiters: mean(samples.map((s) => s.waiters)), dbCpu: mean(samples.map((s) => s.cpu)) });

// The rule: start at the symptom, walk down to the deepest component that is itself abnormal.
function diagnose(healthy, faulty) {
  const h = (s) => red(healthy.events, s), f = (s) => red(faulty.events, s), u = use(faulty.samples);
  for (const d of DEPS) { // fast failures: a bad build, not a slow dependency
    if (f(d).errPm - h(d).errPm >= ERR_JUMP_PM && f(d).failP50 < h(d).p99) return d;
  }
  for (const d of DEPS) if (f(d).p99 >= SLOW_FACTOR * h(d).p99) return d; // a dependency is slow in its own right
  if (f("checkout").p99 >= SLOW_FACTOR * h("checkout").p99) return u.waiters >= POOL_WAITERS_ALERT ? "checkout db pool" : "checkout";
  return "none";
}

const healthy = simulate("none", SEED);
const row = (name, p) => {
  const c = red(p.events, "checkout"), pay = red(p.events, "payments"), inv = red(p.events, "inventory"), db = red(p.events, "db"), u = use(p.samples);
  console.log(`${name.padEnd(16)} checkout avg=${c.avg} p99=${c.p99} err_pm=${c.errPm} fail_p50=${c.failP50} | pay p99=${pay.p99} | inv err_pm=${inv.errPm} | db p99=${db.p99} | pool util=${u.poolUtil} wait=${u.waiters} dbcpu=${u.dbCpu}`);
};
row("healthy", healthy);
console.log(`healthy diagnosis: ${diagnose(healthy, simulate("none", CONTROL_SEED))}`);

let correct = 0;
const hAvg = red(healthy.events, "checkout").avg;
for (const [fault, culprit] of Object.entries(FAULTS)) {
  const faulty = simulate(fault, SEED);
  row(fault, faulty);
  const got = diagnose(healthy, faulty);
  const avgFlags = red(faulty.events, "checkout").avg >= 2 * hAvg; // what an average-only dashboard could say
  console.log(`  -> blame ${got} (expected ${culprit}); average-only alarm: ${avgFlags ? "true" : "false"}`);
  if (got === culprit) correct++;
}
console.log(`classified ${correct} of 4 faults correctly`);
if (correct !== Object.keys(FAULTS).length || diagnose(healthy, simulate("none", CONTROL_SEED)) !== "none") process.exit(1);
if (red(simulate("bad_deploy", SEED).events, "checkout").avg >= hAvg) process.exit(1); // the average even improves
