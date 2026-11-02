// A miniature of Maglev hashing and connection tracking from Google's Maglev paper (NSDI 2016), in JavaScript
// (a teaching model, not Google's code): each backend gets a permutation of the lookup table slots, the backends take turns
// claiming their next free preferred slot, a packet's hash picks a slot, and a per-machine connection table remembers the
// choice so that a connection survives changes to the backend set. Everything is deterministic.

const fnv = (text) => { let h = 0x811c9dc5; for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0; return h; };

function populate(params, M) { // params: [offset, skip] for each backend; returns the lookup table (backend index per slot)
  const next = params.map(() => 0);
  const entry = new Array(M).fill(-1);
  const pref = (i, j) => (params[i][0] + j * params[i][1]) % M; // permutation[i][j] = (offset + j * skip) mod M
  let filled = 0;
  while (true) {
    for (let i = 0; i < params.length; i++) {
      let c = pref(i, next[i]);
      while (entry[c] >= 0) { next[i]++; c = pref(i, next[i]); }
      entry[c] = i; next[i]++; filled++;
      if (filled === M) return entry;
    }
  }
}
const paramsFor = (names, M) => names.map((n) => [fnv(`a${n}`) % M, (fnv(`b${n}`) % (M - 1)) + 1]); // offset and skip come from two hash functions of the name

console.log('--- the paper\'s small example: 3 backends, 7 slots, (offset, skip) = (3,4) (0,2) (3,1)');
const small = [[3, 4], [0, 2], [3, 1]];
const names = ['B0', 'B1', 'B2'];
const before = populate(small, 7);
const kept = [0, 2]; // the backends left after B1 is removed
const after = populate([small[0], small[2]], 7).map((i) => kept[i]);
console.log(`lookup table with B0, B1, B2: ${before.map((i) => names[i]).join(' ')}`);
console.log(`lookup table without B1:      ${after.map((i) => names[i]).join(' ')}`);
const moved = before.filter((b, k) => b !== 1 && after[k] !== b).length;
console.log(`slots that held B1: ${before.filter((b) => b === 1).length}; other slots that changed: ${moved}`);

console.log('--- 100 backends and a table of 65537 slots');
const M = 65537;
const backends = Array.from({ length: 100 }, (_, i) => `backend-${i}`);
const table = populate(paramsFor(backends, M), M);
const counts = backends.map((_, i) => table.filter((e) => e === i).length);
console.log(`slots per backend: min ${Math.min(...counts)}, max ${Math.max(...counts)}`);
const reduced = backends.filter((_, i) => i !== 7);
const table2 = populate(paramsFor(reduced, M), M);
const name1 = (k) => backends[table[k]], name2 = (k) => reduced[table2[k]];
const changed = table.map((_, k) => k).filter((k) => name1(k) !== name2(k)).length;
const onRemoved = table.filter((e) => e === 7).length;
console.log(`removing backend-7: ${onRemoved} slots held it, ${changed} slots changed, ${changed - onRemoved} of them were not backend-7's`);

console.log('--- 1000 connections when backend-7 is removed');
const flows = Array.from({ length: 1000 }, (_, i) => `flow-${i}`);
const slot = (f) => fnv(f) % M;
const tracked = new Map(flows.map((f) => [f, name1(slot(f))])); // the connection table of the Maglev machine that saw the first packets
const onGone = flows.filter((f) => tracked.get(f) === 'backend-7').length;
const withoutTable = flows.filter((f) => name1(slot(f)) !== name2(slot(f))).length;
const withTable = flows.filter((f) => tracked.get(f) === 'backend-7' && name2(slot(f)) !== tracked.get(f)).length;
console.log(`connections on backend-7: ${onGone}`);
console.log(`same machine, with its connection table: ${withTable} connections change backend (only the ones that had to)`);
console.log(`a different Maglev machine after an ECMP change, empty table: ${withoutTable} connections change backend`);
