// Message ordering vs scale-out: competing consumers against a key-partitioned log, with retries.
// A deterministic simulation (integer maths only, so every language prints the same numbers).
const KEYS = 12, N = 240, HOT = 30, PARTS = 4, BACKOFF = 5, LATER = 30;

function fnv1a(s) { // 32-bit FNV-1a: the multiply is masked to 32 bits on purpose
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function rng(seed) { // mulberry32, returns an unsigned 32-bit integer
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (t ^ (t >>> 14)) >>> 0; };
}

function makeStream() { // account events; key 0 is the hot account (30% of traffic)
  const next = rng(42), bal = Array(KEYS).fill(0), seq = Array(KEYS).fill(0), ev = [];
  for (let id = 0; id < N; id++) {
    const u = next(), v = next(), w = next(), a = next(), p = next();
    const key = u % 100 < HOT ? 0 : 1 + (v % (KEYS - 1));
    let nfail = 0, ok = true; // up to 3 failed attempts, 8% each
    for (let j = 0; j < 3; j++) { const d = next(); if (ok && d % 100 < 8) nfail++; else ok = false; }
    const deposit = bal[key] < 20 || w % 2 === 0;
    const amount = deposit ? 20 + (a % 41) : 10 + (a % (bal[key] - 9)); // a withdrawal never exceeds the true balance
    bal[key] += deposit ? amount : -amount;
    ev.push({ id, key, seq: seq[key]++, deposit, amount, proc: 6 + (p % 9), nfail });
  }
  return ev;
}

function run(ev, { partitioned, consumers, retry }) { // events arrive 1 ms apart
  const nq = partitioned ? PARTS : 1, qs = Array.from({ length: nq }, () => []);
  for (const e of ev) qs[partitioned ? fnv1a("acct-" + e.key) % PARTS : 0].push({ id: e.id, at: e.id });
  const load = qs.map((q) => q.length), free = Array(consumers).fill(0), done = Array(ev.length).fill(0), tries = Array(ev.length).fill(0);
  const owns = (c) => (partitioned ? qs.map((_, i) => i).filter((i) => i % consumers === c) : [0]); // a group owns whole partitions
  for (;;) {
    let best = null; // the consumer that can start something earliest
    for (let c = 0; c < consumers; c++) for (const qi of owns(c)) {
      const h = qs[qi][0]; if (!h) continue;
      const s = Math.max(free[c], h.at);
      if (!best || s < best.s || (s === best.s && h.at < best.at)) best = { c, qi, s, at: h.at };
    }
    if (!best) break;
    const q = qs[best.qi], e = ev[q[0].id], nf = retry === "none" ? 0 : e.nfail;
    if (retry === "later" && tries[e.id] < nf) { // failed: back of the line, after its successors
      const item = q.shift(); tries[e.id]++; free[best.c] = best.s + e.proc; item.at = free[best.c] + LATER;
      let i = q.length; while (i > 0 && q[i - 1].at > item.at) i--; q.splice(i, 0, item);
    } else { // success, or retry in place (the partition is blocked until it works)
      const n = retry === "later" ? 1 : nf + 1;
      free[best.c] = done[e.id] = best.s + n * e.proc + (n - 1) * BACKOFF; q.shift();
    }
  }
  const order = ev.map((e) => e.id).sort((a, b) => done[a] - done[b] || a - b);
  const top = Array(KEYS).fill(-1), bal = Array(KEYS).fill(0); let violations = 0, overdrafts = 0;
  for (const id of order) {
    const e = ev[id];
    if (e.seq < top[e.key]) violations++; else top[e.key] = e.seq; // finished after a later event of its key
    if (e.deposit) bal[e.key] += e.amount; else if (bal[e.key] >= e.amount) bal[e.key] -= e.amount; else overdrafts++;
  }
  const span = Math.max(...done);
  return { throughput: Math.floor((ev.length * 1000) / span), violations, overdrafts, hottest: Math.max(...load) };
}

const ev = makeStream();
console.log(`acct-0 -> fnv1a ${fnv1a("acct-0")} -> partition ${fnv1a("acct-0") % PARTS} of ${PARTS}`);
const cases = [
  ["one queue, 1 consumer", { partitioned: false, consumers: 1, retry: "none" }],
  ["one queue, 4 competing", { partitioned: false, consumers: 4, retry: "none" }],
  ["by key, 4 partitions", { partitioned: true, consumers: 4, retry: "none" }],
  ["by key + retry in place", { partitioned: true, consumers: 4, retry: "inplace" }],
  ["by key + retry later", { partitioned: true, consumers: 4, retry: "later" }],
];
const r = {};
for (const [name, cfg] of cases) {
  r[name] = run(ev, cfg);
  const x = r[name];
  console.log(`${name.padEnd(25)} ${String(x.throughput).padStart(4)} ev/s  violations ${String(x.violations).padStart(2)}  overdrafts ${x.overdrafts}  busiest queue ${x.hottest}`);
}
const bad = [];
if (r["one queue, 1 consumer"].violations !== 0) bad.push("a single consumer must be ordered");
if (r["one queue, 4 competing"].violations === 0) bad.push("competing consumers should reorder");
if (r["by key, 4 partitions"].violations !== 0 || r["by key + retry in place"].violations !== 0) bad.push("key partitioning must keep per-key order");
if (r["by key + retry later"].violations === 0) bad.push("retry-later should reorder");
if (r["one queue, 4 competing"].throughput <= r["one queue, 1 consumer"].throughput) bad.push("competing consumers should scale");
if (bad.length) { console.error(bad.join("; ")); process.exit(1); }
console.log("ok");
