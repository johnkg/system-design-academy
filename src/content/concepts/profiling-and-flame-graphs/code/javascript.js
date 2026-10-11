// Build a call tree from sampled stacks (collapsed format "a;b;c count"),
// compute self and total time per function, print a text flame graph and
// check the sampled estimate against the known true proportions.
import assert from "node:assert";

// True CPU microseconds per request, by stack. encode_loop regresses by +1000.
const BASE = [
  ["handler", 160], ["handler;auth", 120], ["handler;route", 80],
  ["handler;parse", 60], ["handler;parse;regex_match", 100],
  ["handler;db_query", 50], ["handler;db_query;driver_decode", 90],
  ["handler;serialize", 50], ["handler;serialize;json_encode", 90],
  ["handler;serialize;json_encode;encode_loop", 170],
  ["handler;audit_log", 30],
];

const truth = (regressed) =>
  BASE.map(([s, w]) => [s, s.endsWith("encode_loop") && regressed ? w + 1000 : w]);

// MINSTD: x = x * 48271 mod (2^31 - 1), exact in doubles and 64-bit ints
function sample(stacks, n, seed) {
  const total = stacks.reduce((a, [, w]) => a + w, 0);
  let x = seed;
  const counts = {};
  for (let i = 0; i < n; i++) {
    x = (x * 48271) % 2147483647;
    let r = x % total;
    for (const [s, w] of stacks) {
      if (r < w) { counts[s] = (counts[s] || 0) + 1; break; }
      r -= w;
    }
  }
  return counts;
}

const collapsed = (counts) =>
  Object.keys(counts).sort().map((s) => `${s} ${counts[s]}`).join("\n");

function build(text) {
  const root = { name: "(all)", selfN: 0, total: 0, kids: {} };
  for (const line of text.split("\n")) {
    const at = line.lastIndexOf(" ");
    const count = parseInt(line.slice(at + 1), 10);
    let node = root;
    root.total += count;
    for (const frame of line.slice(0, at).split(";")) {
      node = node.kids[frame] ??= { name: frame, selfN: 0, total: 0, kids: {} };
      node.total += count;
    }
    node.selfN += count;
  }
  return root;
}

function pct(n, total) { // one decimal, integer math only
  const p = Math.floor((n * 1000) / total);
  return `${Math.floor(p / 10)}.${p % 10}`;
}

function flame(node, total, depth = 0, out = []) {
  const bar = "#".repeat(Math.max(1, Math.floor((node.total * 40) / total)));
  out.push(`${("  ".repeat(depth) + node.name).padEnd(34)} ${bar.padEnd(40)} ${pct(node.total, total).padStart(5)}% self ${pct(node.selfN, total).padStart(5)}%`);
  for (const k of Object.keys(node.kids).sort()) flame(node.kids[k], total, depth + 1, out);
  return out;
}

function check(node) {
  const kids = Object.values(node.kids);
  assert.strictEqual(node.total, node.selfN + kids.reduce((a, k) => a + k.total, 0));
  kids.forEach(check);
}

function selfByFunction(root) {
  const acc = {};
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (n !== root) acc[n.name] = (acc[n.name] || 0) + n.selfN;
    stack.push(...Object.values(n.kids));
  }
  return acc;
}

const N = 6000;
const root = build(collapsed(sample(truth(true), N, 7)));
check(root);
assert.strictEqual(root.total, N);
assert.strictEqual(Object.values(selfByFunction(root)).reduce((a, b) => a + b, 0), N);
console.log(`flame graph, ${N} samples at 100 Hz (width = share, not time):`);
console.log(flame(root, N).join("\n"));
const sv = root.kids.handler.kids.serialize;
console.log(`serialize: total ${pct(sv.total, N)}% but self ${pct(sv.selfN, N)}%`);

const real = truth(true);
const tt = real.reduce((a, [, w]) => a + w, 0);
const trueSelf = Object.fromEntries(real.map(([s, w]) => [s.split(";").pop(), w]));
console.log(`\nestimate error for audit_log (true ${pct(trueSelf.audit_log, tt)}%):`);
for (const n of [100, 1000, 10000, 60000]) {
  const est = selfByFunction(build(collapsed(sample(real, n, 7))));
  const k = est.audit_log || 0;
  let worst = 0;
  for (const [f, w] of Object.entries(trueSelf)) {
    const num = Math.abs((est[f] || 0) * tt - w * n); // |estimate - truth| * n * tt, exact integers
    const p = w / tt;
    assert(num / (n * tt) <= 5 * Math.sqrt((p * (1 - p)) / n) + 1 / n);
    worst = Math.max(worst, num);
  }
  console.log(`n=${String(n).padStart(5)}  audit_log samples=${String(k).padStart(4)}  est ${pct(k, n).padStart(5)}%  worst error over all functions ${pct(worst, n * tt)} pts`);
}

const baseTot = truth(false).reduce((a, [, w]) => a + w, 0);
console.log(`\nregression: total ${baseTot} -> ${tt} us per request, encode_loop share ${pct(170, baseTot)}% -> ${pct(1170, tt)}%`);
assert.strictEqual(tt, baseTot + 1000);
