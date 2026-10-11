// Page assembly with per-dependency timeouts and fallbacks over a seeded set of failures.
// Compares a naive page (everything critical, no fallbacks) with a degrading one.
const DEPS = [
  { name: "product", base: 80, hit: 0 },        // critical, no fallback
  { name: "reviews", base: 60, hit: 90 },       // stale cache: 90% hit
  { name: "recs", base: 120, hit: 100 },        // generic bestsellers
  { name: "inventory", base: 40, hit: 70 },     // cached stock level: 70% hit
  { name: "personal", base: 70, hit: 100 },     // default (logged-out) view
];
const SCENARIOS = [
  ["healthy", {}],
  ["reviews down", { reviews: "down" }],
  ["recs slow", { recs: "slow" }],
  ["inventory down", { inventory: "down" }],
  ["product down", { product: "down" }],
];
const N = 100, CRITICAL_TIMEOUT = 2000, USABLE_MS = 1000;

let seed = 12345;
const next = () => (seed = (seed * 48271) % 2147483647);

// One fixed set of random draws per request, shared by every configuration.
const draws = Array.from({ length: N }, () => DEPS.map(() => [next(), next()]));

function callDep(base, mode, a) {
  if (mode === "down") return { ok: false, ms: 15 + (a % 25) }; // fails fast
  if (mode === "slow") return { ok: true, ms: 1500 + (a % 1000) };
  return { ok: true, ms: base + (a % base) };
}

function assemble(modes, cfg, req) {
  let slowest = 0, errorAt = -1, substituted = 0, missing = 0;
  DEPS.forEach((dep, i) => {
    const critical = i === 0 || cfg.allCritical;
    const limit = critical ? CRITICAL_TIMEOUT : cfg.optionalTimeout;
    let r = callDep(dep.base, modes[dep.name] || "up", req[i][0]);
    if (r.ok && r.ms > limit) r = { ok: false, ms: limit }; // timed out
    if (r.ok) { slowest = Math.max(slowest, r.ms); return; }
    if (critical) { errorAt = errorAt < 0 ? r.ms : Math.min(errorAt, r.ms); return; }
    slowest = Math.max(slowest, r.ms);
    if (cfg.fallbacks && req[i][1] % 100 < dep.hit) substituted++; else missing++;
  });
  if (errorAt >= 0) return { outcome: "error", ms: errorAt + 15 };
  const outcome = substituted + missing > 0 ? "degraded" : "full";
  return { outcome, ms: slowest + (substituted > 0 ? 5 : 0) + 15 };
}

const CONFIGS = [
  ["naive", { allCritical: true, fallbacks: false, optionalTimeout: CRITICAL_TIMEOUT }],
  ["degrading", { allCritical: false, fallbacks: true, optionalTimeout: 300 }],
];
const results = {};
for (const [label, modes] of SCENARIOS) {
  for (const [cname, cfg] of CONFIGS) {
    const pages = draws.map((req) => assemble(modes, cfg, req));
    const count = (o) => pages.filter((p) => p.outcome === o).length;
    const lat = pages.map((p) => p.ms).sort((x, y) => x - y);
    const usable = pages.filter((p) => p.outcome !== "error" && p.ms <= USABLE_MS).length;
    const r = { full: count("full"), degraded: count("degraded"), error: count("error"), p95: lat[Math.floor((N * 95) / 100)], usable };
    results[label + "/" + cname] = r;
    console.log(`${label.padEnd(15)} ${cname.padEnd(10)} full=${String(r.full).padStart(3)} degraded=${String(r.degraded).padStart(3)} error=${String(r.error).padStart(3)} p95=${String(r.p95).padStart(4)}ms usable=${String(r.usable).padStart(3)}%`);
  }
}

// Invariants: an optional failure never fails the degrading page; a critical failure always does.
for (const [label] of SCENARIOS) {
  const d = results[label + "/degrading"];
  if (label === "product down") { if (d.error !== N) throw new Error("critical failure must fail every page"); }
  else if (d.error !== 0) throw new Error("optional failure failed a page: " + label);
}
if (results["reviews down/naive"].error !== N) throw new Error("naive page should fail when reviews is down");
if (results["recs slow/degrading"].p95 > 320) throw new Error("optional timeout must bound page latency");
if (results["recs slow/naive"].p95 <= 1000) throw new Error("naive page should be slow when recs is slow");
console.log("invariants hold");
