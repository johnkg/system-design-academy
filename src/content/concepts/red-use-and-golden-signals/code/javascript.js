// RED and USE summaries from a seeded event stream, and a rule that names the failing component.
// Integers only, so JavaScript, C# and Python print exactly the same text.

const DEPS = ["payments", "inventory", "db"];
const FAULTS = {
  payments_slow: "payments",
  db_lock: "db",
  pool_exhaustion: "checkout db pool",
  bad_deploy: "inventory",
};

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
  const events = []; // { svc, dur, ok }
  for (let i = 0; i < 400; i++) {
    const own = 10 + (r() % 20);
    let pay = 40 + (r() % 40), inv = 15 + (r() % 15), db = 4 + (r() % 8), pool = 0, ok = true;
    if (fault === "payments_slow") pay *= 12;
    if (fault === "db_lock") db += 600 + (r() % 400);
    if (fault === "pool_exhaustion") pool = 500 + (r() % 500); // waiting for a connection, not a slow query
    if (fault === "bad_deploy" && r() % 100 < 25) { ok = false; inv = 5 + (r() % 8); }
    if (ok) {
      events.push({ svc: "payments", dur: pay, ok: true }, { svc: "db", dur: db, ok: true });
      events.push({ svc: "inventory", dur: inv, ok: true }, { svc: "checkout", dur: own + pool + pay + inv + db, ok: true });
    } else { // the bad inventory build fails fast and checkout returns 500 straight away
      events.push({ svc: "inventory", dur: inv, ok: false }, { svc: "checkout", dur: own + inv, ok: false });
    }
  }
  const samples = []; // { poolUtil, waiters, runq, cpu }
  for (let i = 0; i < 12; i++) {
    let poolUtil = 30 + (r() % 15), waiters = 0, cpu = 25 + (r() % 10);
    if (fault === "pool_exhaustion") { poolUtil = 100; waiters = 20 + (r() % 10); cpu = 15 + (r() % 5); } // starved database idles
    if (fault === "db_lock") { poolUtil = 100; waiters = 10 + (r() % 10); cpu = 5 + (r() % 5); }
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
    if (f(d).errPm - h(d).errPm >= 50 && f(d).failP50 < h(d).p99) return d;
  }
  for (const d of DEPS) if (f(d).p99 >= 3 * h(d).p99) return d; // a dependency is slow in its own right
  if (f("checkout").p99 >= 3 * h("checkout").p99) return u.waiters >= 10 ? "checkout db pool" : "checkout";
  return "none";
}

const healthy = simulate("none", 7);
const row = (name, p) => {
  const c = red(p.events, "checkout"), pay = red(p.events, "payments"), inv = red(p.events, "inventory"), db = red(p.events, "db"), u = use(p.samples);
  console.log(`${name.padEnd(16)} checkout avg=${c.avg} p99=${c.p99} err_pm=${c.errPm} fail_p50=${c.failP50} | pay p99=${pay.p99} | inv err_pm=${inv.errPm} | db p99=${db.p99} | pool util=${u.poolUtil} wait=${u.waiters} dbcpu=${u.dbCpu}`);
};
row("healthy", healthy);
console.log(`healthy diagnosis: ${diagnose(healthy, simulate("none", 8))}`);

let correct = 0;
const hAvg = red(healthy.events, "checkout").avg;
for (const [fault, culprit] of Object.entries(FAULTS)) {
  const faulty = simulate(fault, 7);
  row(fault, faulty);
  const got = diagnose(healthy, faulty);
  const avgFlags = red(faulty.events, "checkout").avg >= 2 * hAvg; // what an average-only dashboard could say
  console.log(`  -> blame ${got} (expected ${culprit}); average-only alarm: ${avgFlags ? "true" : "false"}`);
  if (got === culprit) correct++;
}
console.log(`classified ${correct} of 4 faults correctly`);
if (correct !== 4 || diagnose(healthy, simulate("none", 8)) !== "none") process.exit(1);
if (red(simulate("bad_deploy", 7).events, "checkout").avg >= hAvg) process.exit(1); // the average even improves
