// An erasure-coded object store in miniature, in JavaScript:
// a Reed-Solomon code (4 data + 2 parity shards) over GF(256), shards placed on racks, disks and racks failing, and repair.

const K = 4, M = 2, N = K + M;                       // any K of the N shards rebuild the object
const RACKS = N, DISKS = 8, OBJECTS = 200, ROUNDS = 20, P_DISK = 0.02, P_RACK = 0.03;

// Arithmetic in GF(256): addition is XOR, multiplication goes through log and antilog tables.
const EXP = new Array(512), LOG = new Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
const inv = (a) => EXP[255 - LOG[a]];

// Row s of the coding matrix: shards 0..K-1 are the data itself, the rest are Cauchy rows, so any K rows can be inverted.
const row = (s) => Array.from({ length: K }, (_, j) => (s < K ? +(s === j) : inv(s ^ j)));

function encode(data) {                              // data is split in K pieces, and N shards come out
  const len = data.length / K;
  return Array.from({ length: N }, (_, s) => Uint8Array.from({ length: len }, (_, t) => row(s).reduce((acc, c, j) => acc ^ mul(c, data[j * len + t]), 0)));
}

function invert(a) {                                 // Gauss-Jordan elimination in GF(256)
  let m = a.map((r, i) => [...r, ...Array.from({ length: K }, (_, j) => +(i === j))]);
  for (let c = 0; c < K; c++) {
    let p = c; while (m[p][c] === 0) p++;
    [m[c], m[p]] = [m[p], m[c]];
    const iv = inv(m[c][c]); m[c] = m[c].map((v) => mul(v, iv));
    for (let r = 0; r < K; r++) if (r !== c && m[r][c]) { const f = m[r][c]; m[r] = m[r].map((v, j) => v ^ mul(f, m[c][j])); }
  }
  return m.map((r) => r.slice(K));
}

function decode(shards) {                            // shards has null where a shard is gone; needs at least K of them
  const have = shards.map((s, i) => (s ? i : -1)).filter((i) => i >= 0).slice(0, K);
  if (have.length < K) return null;
  const back = invert(have.map(row)), len = shards[have[0]].length, out = new Uint8Array(K * len);
  for (let j = 0; j < K; j++) for (let t = 0; t < len; t++) out[j * len + t] = have.reduce((acc, s, i) => acc ^ mul(back[j][i], shards[s][t]), 0);
  return out;
}

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
function mulberry32(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function simulate(spread) {                          // spread: one shard per rack; otherwise all shards in one rack
  const place = mulberry32(7), fail = mulberry32(99);  // separate streams, so both layouts face the same failures
  const ri = (n) => Math.floor(place() * n);
  const pick = (rack, used) => { let d; do d = rack * DISKS + ri(DISKS); while (used.has(d)); return d; };
  const objects = Array.from({ length: OBJECTS }, () => {
    const data = Uint8Array.from({ length: 64 }, () => ri(256)), home = ri(RACKS), used = new Set(), loc = [];
    for (let s = 0; s < N; s++) { const d = pick(spread ? s : home, used); used.add(d); loc.push(d); }
    return { data, shards: encode(data), loc, lost: false };
  });
  const st = { lost: 0, rebuilt: 0, read: 0, wrote: 0 };
  for (let r = 0; r < ROUNDS; r++) {
    const dead = new Set();
    for (let rack = 0; rack < RACKS; rack++) if (fail() < P_RACK) for (let d = 0; d < DISKS; d++) dead.add(rack * DISKS + d);
    for (let d = 0; d < RACKS * DISKS; d++) if (fail() < P_DISK) dead.add(d);
    for (const o of objects) {
      if (o.lost) continue;
      o.loc.forEach((d, s) => { if (dead.has(d)) o.shards[s] = null; });
      const missing = o.shards.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);
      if (!missing.length) continue;
      const data = decode(o.shards);
      if (!data) { o.lost = true; st.lost++; continue; }
      const fresh = encode(data), used = new Set(o.loc);
      for (const s of missing) { const d = pick(Math.floor(o.loc[s] / DISKS), used); used.add(d); o.loc[s] = d; o.shards[s] = fresh[s]; st.wrote += 16; st.rebuilt++; }
      st.read += K * 16;                             // one decode reads K shards of 16 bytes, however many shards are rebuilt
    }
  }
  for (const o of objects) if (!o.lost && !same(decode(o.shards), o.data)) throw new Error('corrupt object');
  return st;
}

// Chance that an object is lost when each shard is lost with probability p before repair: more than tol shards gone.
function loss(n, tol, p) {
  let total = 0, c = 1;
  for (let i = 0; i <= n; i++) {
    if (i > 0) c = (c * (n - i + 1)) / i;
    let t = c; for (let j = 0; j < i; j++) t *= p; for (let j = 0; j < n - i; j++) t *= 1 - p;
    if (i > tol) total += t;
  }
  return total;
}
const perBillion = (x) => Math.floor(x * 1e9 + 0.5);

// 1. Every pattern of up to M missing shards decodes; M+1 missing shards never do.
const sample = Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 11) & 255), whole = encode(sample);
let ok = 0, fine = 0, dead = 0, tooMany = 0;
for (let mask = 0; mask < 1 << N; mask++) {
  const gone = mask.toString(2).split('1').length - 1;
  if (gone > M + 1) continue;
  const out = decode(whole.map((s, i) => (mask >> i & 1 ? null : s)));
  if (gone <= M) { fine++; if (out && same(out, sample)) ok++; } else { tooMany++; if (!out) dead++; }
}
console.log(`${K}+${M} code: ${ok} of ${fine} patterns with up to ${M} lost shards decode correctly; ${dead} of ${tooMany} with ${M + 1} lost cannot`);
console.log(`storage overhead ${(N / K).toFixed(2)}x, against 3.00x for three copies`);

// 2. Racks and disks fail for 20 rounds, and repair runs after every round.
for (const spread of [true, false]) {
  const s = simulate(spread);
  console.log(`${spread ? 'one shard per rack  ' : 'all shards in a rack'}: lost ${s.lost} of ${OBJECTS} objects, rebuilt ${s.rebuilt} shards, read ${s.read} bytes and wrote ${s.wrote} bytes`);
}

// 3. The same durability maths for three layouts when each disk is lost with probability 1%.
const layouts = [['3 copies', 3, 2], ['4+2', 6, 2], ['10+4', 14, 4]];
layouts.forEach(([name, n, tol]) => console.log(`${name.padEnd(8)} loses ${perBillion(loss(n, tol, 0.01))} objects per billion`));
if (ok !== fine || dead !== tooMany || simulate(true).lost >= simulate(false).lost) process.exit(1);
