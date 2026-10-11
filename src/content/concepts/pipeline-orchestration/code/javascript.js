// A tiny orchestrator: a DAG of tasks per date, retries with backoff, upstream_failed, and clear-and-rerun.
// Each task writes 10 rows for its date. A failing attempt dies after writing 5 rows.
const TASKS = [
  { name: "extract", up: [] },
  { name: "clean", up: [0] },
  { name: "aggregate", up: [1] },
  { name: "publish", up: [2] },
];
const DATES = ["03-01", "03-02", "03-03"];
const FULL = 10, PARTIAL = 5;
// failing attempts per [date][task]: 03-02 clean fails once (transient), 03-03 aggregate fails every time (hard)
const FAILS = [[0, 0, 0, 0], [0, 1, 0, 0], [0, 0, 99, 0]];

function runPipeline(retries, idempotent, only, failsLeft, state, rows, log) {
  // only: set of "d:t" keys to run; null means everything. Tasks run in topological order (the array order).
  for (let d = 0; d < DATES.length; d++) {
    TASKS.forEach((task, t) => {
      const key = d + ":" + t;
      if (only && !only.has(key)) return;
      if (task.up.some((u) => state[d][u] !== "success")) {
        state[d][t] = "upstream_failed";
        log.push(DATES[d] + " " + task.name + " upstream_failed");
        return;
      }
      for (let attempt = 1; ; attempt++) {
        const fail = failsLeft[d][t] > 0;
        if (fail) failsLeft[d][t]--;
        const n = fail ? PARTIAL : FULL;
        rows[key] = idempotent ? n : (rows[key] || 0) + n; // overwrite the partition, or append
        if (!fail) { state[d][t] = "success"; log.push(DATES[d] + " " + task.name + " success attempts=" + attempt); return; }
        if (attempt > retries) { state[d][t] = "failed"; log.push(DATES[d] + " " + task.name + " failed attempts=" + attempt); return; }
        log.push(DATES[d] + " " + task.name + " retry in " + 2 ** attempt + "m");
      }
    });
  }
}

function scenario(label, retries, idempotent, clearAndRerun) {
  const state = DATES.map(() => TASKS.map(() => "queued"));
  const rows = {}, log = [];
  const failsLeft = FAILS.map((r) => r.slice());
  runPipeline(retries, idempotent, null, failsLeft, state, rows, log);
  if (clearAndRerun) {
    // the operator fixed the cause: clear every failed or upstream_failed instance and run them again
    const only = new Set();
    state.forEach((r, d) => r.forEach((s, t) => { if (s !== "success") { only.add(d + ":" + t); } }));
    only.forEach((k) => { const [d, t] = k.split(":").map(Number); state[d][t] = "queued"; failsLeft[d][t] = 0; });
    runPipeline(retries, idempotent, only, failsLeft, state, rows, log);
  }
  const total = Object.values(rows).reduce((a, b) => a + b, 0);
  const expected = DATES.length * TASKS.length * FULL;
  console.log("== " + label + " ==");
  log.forEach((l) => console.log("  " + l));
  console.log("  rows=" + total + " expected=" + expected + " duplicates=" + Math.max(0, total - expected));
  return { total, expected, state };
}

const a = scenario("no retries, overwrite, no operator", 0, true, false);
const b = scenario("2 retries, overwrite, no operator", 2, true, false);
const c = scenario("2 retries, overwrite, clear and rerun", 2, true, true);
const d = scenario("2 retries, append, clear and rerun", 2, false, true);

if (a.state[1][1] !== "failed" || a.state[1][3] !== "upstream_failed") process.exit(1);
if (b.state[1][1] !== "success" || b.state[2][2] !== "failed") process.exit(1);
if (c.total !== c.expected) process.exit(1);
if (d.total <= d.expected) process.exit(1);
console.log("ok");
