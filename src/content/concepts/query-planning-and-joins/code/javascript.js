// A mini query planner: estimate the cost of three join methods from row counts, pick the cheapest,
// then run all three for real and compare the estimate with what happened. Integer maths only, so the output is exact.
const SEQ = 1000, TUPLE = 10, CMP = 3, HASH = 5, SETUP = 1000; // cost units: one sequential page read = 1000
const CUST_PER_PAGE = 40, ORD_PER_PAGE = 100;
const METHODS = ["nested loop", "hash join", "merge join"];

function makeTables(nCust, nOrd, presorted = false) {
  let state = 7;
  const rnd = (n) => { // tiny LCG, so every run (and every language) sees the same rows
    state = (state * 1664525 + 1013904223) % 4294967296;
    return Math.floor(state / 256) % n;
  };
  const customers = [];
  for (let i = 1; i <= nCust; i++) customers.push([i, rnd(10) === 0 ? "NL" : "US"]);
  const orders = [];
  for (let i = 1; i <= nOrd; i++) orders.push([i, 1 + Math.min(rnd(nCust), rnd(nCust))]); // skewed: low ids order more
  if (presorted) orders.sort((a, b) => a[1] - b[1] || a[0] - b[0]); // like a table clustered on customer_id
  return [customers, orders];
}

const pages = (rows, perPage) => Math.floor((rows + perPage - 1) / perPage);
const log2Ceil = (n) => (n > 1 ? 32 - Math.clz32(n - 1) : 0);

// Cost from statistics only: st = [customer rows, order rows, distinct customer ids in orders, filtered customers].
function estimate(method, st, pCust, pOrd, presorted) {
  const [nCust, nOrd, ndv, k] = st;
  const m = Math.floor((k * nOrd) / ndv); // estimated join output
  const base = pCust * SEQ + nCust * TUPLE;
  if (method === "nested loop") return base + pOrd * SEQ + nOrd * TUPLE + k * nOrd * CMP;
  if (method === "hash join") return base + pOrd * SEQ + nOrd * TUPLE + (k + nOrd) * HASH + m * CMP + SETUP;
  return base + pOrd * SEQ + (nOrd + k) * TUPLE + (k + nOrd + (presorted ? 0 : nOrd * log2Ceil(nOrd))) * CMP; // merge: sort orders first unless already sorted
}

function mergeSort(rows, key, c) {
  if (rows.length <= 1) return rows;
  const mid = Math.floor(rows.length / 2);
  const left = mergeSort(rows.slice(0, mid), key, c), right = mergeSort(rows.slice(mid), key, c);
  const out = []; let i = 0, j = 0;
  while (i < left.length && j < right.length) {
    c[0]++;
    if (key(right[j]) < key(left[i])) out.push(right[j++]); else out.push(left[i++]);
  }
  return out.concat(left.slice(i), right.slice(j));
}

// Execute the join and count the work. Returns [sorted result rows, cost in units, comparisons].
function run(method, customers, orders, country, presorted) {
  const w = { seq: pages(customers.length, CUST_PER_PAGE) + pages(orders.length, ORD_PER_PAGE), tuples: customers.length + orders.length, cmp: 0, hash: 0, setup: 0 };
  const outer = customers.filter((c) => c[1] === country).map((c) => c[0]);
  const out = [];
  if (method === "nested loop") {
    for (const cid of outer) for (const [oid, ocid] of orders) { w.cmp++; if (ocid === cid) out.push(oid * 1000 + cid); }
  } else if (method === "hash join") {
    w.setup = SETUP;
    const table = new Set();
    for (const cid of outer) { w.hash++; table.add(cid); }
    for (const [oid, ocid] of orders) { w.hash++; if (table.has(ocid)) { w.cmp++; out.push(oid * 1000 + ocid); } }
  } else {
    const c = [0];
    let ordered = orders.map(([oid, ocid]) => [ocid, oid]);
    if (!presorted) ordered = mergeSort(ordered, (r) => r[0], c);
    w.cmp += c[0]; w.tuples += outer.length;
    let i = 0, j = 0;
    while (i < outer.length && j < ordered.length) {
      w.cmp++;
      if (outer[i] < ordered[j][0]) i++;
      else if (outer[i] > ordered[j][0]) j++;
      else { out.push(ordered[j][1] * 1000 + outer[i]); j++; }
    }
  }
  out.sort((a, b) => a - b);
  return [out, w.seq * SEQ + w.tuples * TUPLE + w.cmp * CMP + w.hash * HASH + w.setup, w.cmp + w.hash];
}

function checksum(rows) { let h = 0; for (const v of rows) h = (h * 31 + v) % 1000003; return h; }
const cheapest = (f) => METHODS.reduce((a, b) => (f(b) < f(a) ? b : a));

function planAndRun(label, nCust, nOrd, stale, presorted = false) {
  const [customers, orders] = makeTables(nCust, nOrd, presorted);
  const pC = pages(nCust, CUST_PER_PAGE), pO = pages(nOrd, ORD_PER_PAGE); // page counts always come from the file size
  const ndv = new Set(orders.map((o) => o[1])).size;
  const kReal = customers.filter((c) => c[1] === "NL").length;
  // fresh statistics are exact; stale ones are from when the tables were 20x smaller and NL was rare (0.2%)
  const st = stale ? [Math.max(1, Math.floor(nCust / 20)), Math.max(1, Math.floor(nOrd / 20)), Math.max(1, Math.floor(ndv / 20)), 1] : [nCust, nOrd, ndv, kReal];
  const est = {}, runs = {};
  for (const m of METHODS) { est[m] = estimate(m, st, pC, pO, presorted); runs[m] = run(m, customers, orders, "NL", presorted); }
  const pick = cheapest((m) => est[m]);
  if (runs["nested loop"][0].join() !== runs["hash join"][0].join() || runs["hash join"][0].join() !== runs["merge join"][0].join()) throw new Error("methods disagree");
  const best = cheapest((m) => runs[m][1]);
  console.log(`${label}: ${nCust} customers, ${nOrd} orders, filter matches ${kReal} (planner expects ${st[3]})`);
  for (const m of METHODS) console.log(`  ${m.padEnd(11)} est ${String(est[m]).padStart(9)}  actual ${String(runs[m][1]).padStart(9)}  compared ${String(runs[m][2]).padStart(8)}`);
  const rows = runs[pick][0];
  console.log(`  planner picks ${pick}; cheapest in reality: ${best}; ${rows.length} rows, checksum ${checksum(rows)}`);
  return [pick, best, runs[pick][1], runs[best][1]];
}

function expect(ok, msg) { if (!ok) throw new Error(msg); }
let [pick, best] = planAndRun("tiny", 16, 60, false);
expect(pick === "nested loop" && best === "nested loop", "tiny: nested loop should win");
[pick, best] = planAndRun("large", 1000, 20000, false);
expect(pick === "hash join" && best === "hash join", "large: hash join should win");
let [stalePick, staleBest, got, ideal] = planAndRun("large, stale stats", 1000, 20000, true);
expect(stalePick === "nested loop" && staleBest === "hash join" && got > 5 * ideal, "stale statistics should pick the wrong method");
[pick, best] = planAndRun("large, orders sorted by customer_id", 1000, 20000, false, true);
expect(pick === "merge join" && best === "merge join", "sorted input: merge join should win");
console.log(`stale statistics made the query cost ${Math.floor(got / ideal)}x more than necessary`);
