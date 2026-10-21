// LLM caching and routing: an exact cache, a semantic cache (toy 4-number "embeddings") and a
// two-model cascade, replayed over the same seeded workload. All money is integer nano-dollars.

const VEC = [[9, 1, 2, 0], [9, 1, 2, 2], [1, 9, 0, 1], [1, 8, 1, 3], [0, 1, 9, 2], [2, 0, 3, 9]];
const WEIGHT = [30, 20, 20, 10, 12, 8]; // how often each question topic is asked
const TENANT_SPECIFIC = [false, false, false, false, true, true]; // answer depends on who asks
const PRICE = { small: [150, 600], large: [3000, 15000] }; // nano-dollars per input / output token
const IN_TOK = 800, OUT_TOK = 150;
const SEED = 7, QUERIES = 240, TENANTS = 2, WORDINGS = 3; // 3 fixed wordings per topic
const FRESH_PERCENT = 40, HARD_PERCENT = 30, SMALL_SOLVES_HARD_PERCENT = 25;
// Confidence: a hard question is usually low (0..59), otherwise 70..99.
const LOW_CONF_PERCENT = 75, LOW_CONF_RANGE = 60, HIGH_CONF_MIN = 70, HIGH_CONF_RANGE = 30;
const PERMILLE = 1000, NANO_PER_MICRO = 1000;

function makeWorkload(n) {
  let s = SEED;
  // Linear congruential generator (Numerical Recipes constants).
  const rnd = (m) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s >>> 16) % m; };
  const work = [];
  for (let i = 0; i < n; i++) {
    const tenant = rnd(TENANTS);
    const r = rnd(100);
    let intent = 0, acc = 0;
    for (let k = 0; k < WEIGHT.length; k++) { acc += WEIGHT[k]; if (r < acc) { intent = k; break; } }
    const wording = rnd(WORDINGS);
    const fresh = rnd(100) < FRESH_PERCENT; // 40% of questions use brand-new wording
    const noise = [rnd(3) - 1, rnd(3) - 1, rnd(3) - 1, rnd(3) - 1];
    const hard = rnd(100) < HARD_PERCENT;
    const smallOk = hard ? rnd(100) < SMALL_SOLVES_HARD_PERCENT : true;
    const conf = hard ? (rnd(100) < LOW_CONF_PERCENT ? rnd(LOW_CONF_RANGE) : HIGH_CONF_MIN + rnd(HIGH_CONF_RANGE)) : HIGH_CONF_MIN + rnd(HIGH_CONF_RANGE);
    const wobble = [[0, 0, 0, 0], [-1, 0, 1, 0], [0, 1, 0, -1]][wording];
    const vec = VEC[intent].map((v, d) => v + (fresh ? noise[d] : wobble[d]));
    work.push({ i, tenant, intent, key: fresh ? "u" + i : intent + ":" + wording, vec, smallOk, conf });
  }
  return work;
}

const dot = (a, b) => a.reduce((t, v, d) => t + v * b[d], 0);
const simOk = (a, b, thr) => { const d = dot(a, b); return d > 0 && d * d * PERMILLE * PERMILLE >= thr * thr * dot(a, a) * dot(b, b); };
const permille = (a, b) => Math.floor((PERMILLE * dot(a, b)) / Math.sqrt(dot(a, a) * dot(b, b)));
const callCost = (m) => IN_TOK * PRICE[m][0] + OUT_TOK * PRICE[m][1];

function run(work, { cache, thr = 950, isolate = true, route = "large", escalate = 65 }) {
  const store = []; // each entry: { key, tenant, intent, vec, ok }
  let cost = 0, hits = 0, wrong = 0;
  for (const q of work) {
    let hit = null;
    for (const e of store) {
      if (isolate && e.tenant !== q.tenant) continue;
      const match = cache === "exact" ? e.key === q.key : cache === "semantic" && simOk(q.vec, e.vec, thr);
      if (match && (!hit || permille(q.vec, e.vec) > permille(q.vec, hit.vec))) hit = e;
    }
    if (hit) {
      hits++;
      const leaked = TENANT_SPECIFIC[q.intent] && hit.tenant !== q.tenant;
      if (leaked || hit.intent !== q.intent || !hit.ok) wrong++;
      continue;
    }
    let ok = true;
    if (route === "large") cost += callCost("large");
    else {
      cost += callCost("small");
      ok = q.smallOk;
      if (route === "cascade" && q.conf < escalate) { cost += callCost("large"); ok = true; }
    }
    if (!ok) wrong++;
    if (cache !== "none") store.push({ key: q.key, tenant: q.tenant, intent: q.intent, vec: q.vec, ok });
  }
  return { cost, hits, wrong };
}

const work = makeWorkload(QUERIES);
const base = work.length * callCost("large");
console.log(`one large call = ${callCost("large")} nano-dollars, one small call = ${callCost("small")}`);
const configs = [
  ["no cache, large model", { cache: "none" }],
  ["exact cache", { cache: "exact" }],
  ["semantic 0.90", { cache: "semantic", thr: 900 }],
  ["semantic 0.95", { cache: "semantic", thr: 950 }],
  ["semantic 0.99", { cache: "semantic", thr: 990 }],
  ["semantic 0.95 shared", { cache: "semantic", thr: 950, isolate: false }],
  ["small model only", { cache: "none", route: "small" }],
  ["cascade, escalate <65", { cache: "none", route: "cascade" }],
  ["semantic 0.98 + cascade", { cache: "semantic", thr: 980, route: "cascade" }],
];
const results = {};
for (const [label, cfg] of configs) {
  const r = run(work, cfg);
  results[label] = r;
  const saved = Math.floor((100 * (base - r.cost)) / base);
  console.log(`${label.padEnd(24)} cost=${Math.floor(r.cost / NANO_PER_MICRO)}u$ saved=${saved}% hits=${r.hits} wrong=${r.wrong}`);
}
const R = results;
if (R["no cache, large model"].wrong !== 0) process.exit(1);
if (!(R["semantic 0.90"].wrong > R["semantic 0.99"].wrong)) process.exit(1);
if (!(R["semantic 0.95 shared"].wrong > R["semantic 0.95"].wrong)) process.exit(1);
if (!(R["cascade, escalate <65"].wrong < R["small model only"].wrong)) process.exit(1);
if (!(R["cascade, escalate <65"].cost < base)) process.exit(1);
console.log("invariants hold");
