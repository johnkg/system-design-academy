// Maglev-style consistent hashing for a load balancer, in JavaScript:
// every balancer builds the same lookup table from the backend names, so any of them sends a flow to the same backend,
// and when a backend leaves only the flows that were on it have to move. A connection-tracking table then pins live flows.

const M = 997; // table size, a prime number (Maglev uses 65,537 or more)

const hashName = (s, seed) => { // FNV-1a with a seed, kept to 32 bits
  let h = (seed ^ 2166136261) >>> 0;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
};
const flowHash = (i) => { // stands in for a hash of the 5-tuple (source and destination address and port, protocol)
  let h = Math.imul(i + 1, 2654435761) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0; h = Math.imul(h, 2246822519) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
};

// Each backend has its own permutation of the table slots. Backends take turns claiming their next free slot.
function buildTable(names) {
  const offset = names.map((n) => hashName(n, 1) % M);
  const skip = names.map((n) => (hashName(n, 2) % (M - 1)) + 1);
  const next = names.map(() => 0);
  const table = new Array(M).fill(-1);
  for (let filled = 0; filled < M; ) {
    for (let b = 0; b < names.length && filled < M; b++) {
      let slot = (offset[b] + next[b] * skip[b]) % M;
      while (table[slot] >= 0) { next[b]++; slot = (offset[b] + next[b] * skip[b]) % M; }
      table[slot] = b; next[b]++; filled++;
    }
  }
  return table.map((b) => names[b]);
}

const pct = (part, whole) => { const t = Math.floor((part * 1000) / whole); return `${Math.floor(t / 10)}.${t % 10}%`; };

const FLOWS = 20000;
const names = ['b0', 'b1', 'b2', 'b3', 'b4'];
const table = buildTable(names);
const share = {}; names.forEach((n) => (share[n] = 0));
for (let i = 0; i < FLOWS; i++) share[table[flowHash(i) % M]]++;
console.log(`flows per backend: ${names.map((n) => `${n}=${share[n]}`).join(' ')}`);

// Remove b2: how many flows that were NOT on b2 get moved, with a modulo hash and with the Maglev table?
const smaller = names.filter((n) => n !== 'b2');
const table2 = buildTable(smaller);
let onB2 = 0, moduloMoved = 0, maglevMoved = 0;
for (let i = 0; i < FLOWS; i++) {
  const h = flowHash(i), before = table[h % M];
  if (before === 'b2') { onB2++; continue; }
  if (names[h % names.length] !== smaller[h % smaller.length]) moduloMoved++;
  if (before !== table2[h % M]) maglevMoved++;
}
const others = FLOWS - onB2;
console.log(`b2 removed, flows on b2 (must move): ${onB2}`);
console.log(`other flows moved, modulo hash: ${moduloMoved} of ${others} (${pct(moduloMoved, others)})`);
console.log(`other flows moved, Maglev table: ${maglevMoved} of ${others} (${pct(maglevMoved, others)})`);

// Connection tracking: a new flow is looked up in the table once, then remembered, so adding b5 later never breaks it.
const tracked = new Map();
const route = (i, tbl) => { if (!tracked.has(i)) tracked.set(i, tbl[flowHash(i) % M]); return tracked.get(i); };
for (let i = 0; i < FLOWS; i++) route(i, table);
const table3 = buildTable([...names, 'b5']);
let brokenTracked = 0, brokenUntracked = 0;
for (let i = 0; i < FLOWS; i++) {
  if (route(i, table3) !== table[flowHash(i) % M]) brokenTracked++;
  if (table3[flowHash(i) % M] !== table[flowHash(i) % M]) brokenUntracked++;
}
console.log(`b5 added: broken flows without tracking ${brokenUntracked} (${pct(brokenUntracked, FLOWS)}), with tracking ${brokenTracked}`);

const counts = Object.values(share);
const ok = Math.max(...counts) - Math.min(...counts) < FLOWS / names.length / 10 && maglevMoved * 5 < others && moduloMoved * 2 > others && brokenTracked === 0;
console.log(`checks pass: ${ok}`);
if (!ok) process.exit(1);
