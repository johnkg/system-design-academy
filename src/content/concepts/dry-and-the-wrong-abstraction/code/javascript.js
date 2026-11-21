// DRY and the wrong abstraction: retail and wholesale shipping start out looking identical. Part 1 has the three designs as real
// functions (copy-paste, one merged function with flags, a shared core with separate edges) after four change requests that each
// concern ONE case, and shows they agree while their signatures differ. Part 2 counts the edits over a year of 20 change
// requests, as the share that concern only one case grows. Look for: the flag count and 2^flags of the merged function, and where
// copy-paste and merging cross over.
const ceilKg = (grams) => Math.floor((grams + 999) / 1000);
const tariff = (grams) => 500 + 120 * ceilKg(grams); // the carrier's price list: real, shared knowledge (cents)

// 1. Copy-paste: each case keeps its own copy of the tariff formula.
const retailCopy = (grams, order, remote) => {
  if (order >= 5000) return 0;                                  // change 1: retail free shipping over 50.00
  return 500 + 120 * ceilKg(grams) + (remote ? 300 : 0);        // change 2: retail remote-area surcharge
};
const wholesaleCopy = (grams) => {
  let c = 500 + 120 * ceilKg(grams);
  if (grams > 20000) c -= 40 * ceilKg(grams);                   // change 3: wholesale pallet discount
  return c + Math.floor((c * 8) / 100);                         // change 4: wholesale fuel surcharge of 8%
};
// 2. Merged: one function that serves both, so every difference became a flag.
const merged = (grams, order, freeOver, remote, pallet, fuel) => {
  let c = tariff(grams);
  if (freeOver && order >= 5000) return 0;
  if (remote) c += 300;
  if (pallet && grams > 20000) c -= 40 * ceilKg(grams);
  if (fuel) c += Math.floor((c * 8) / 100);
  return c;
};
// 3. Shared core, separate edges: only the price list is shared.
const retailShared = (grams, order, remote) => (order >= 5000 ? 0 : tariff(grams) + (remote ? 300 : 0));
const wholesaleShared = (grams) => { const c = tariff(grams) - (grams > 20000 ? 40 * ceilKg(grams) : 0); return c + Math.floor((c * 8) / 100); };

const SHIPMENTS = [[2500, 3000, false], [800, 9000, false], [30000, 12000, true], [21500, 400, true]];
let agree = true;
for (const [g, o, r] of SHIPMENTS) {
  const a = [retailCopy(g, o, r), merged(g, o, true, r, false, false), retailShared(g, o, r)];
  const b = [wholesaleCopy(g), merged(g, o, false, false, true, true), wholesaleShared(g)];
  if (new Set(a).size > 1 || new Set(b).size > 1) agree = false;
  console.log(`${g} g, order ${o}, remote ${r}: retail ${a[0]}, wholesale ${b[0]}`);
}
console.log(`all three designs agree: ${agree}`);
console.log(`parameters: copy-paste ${retailCopy.length} and ${wholesaleCopy.length}, merged ${merged.length}, shared core ${retailShared.length} and ${wholesaleShared.length} (plus tariff ${tariff.length})`);

// Part 2: a year of N change requests. Some concern both cases (the price list changes), the rest only one of them.
// copy-paste: a shared change is made twice (and a copy can be missed); a divergent one once.
// merged: the merge itself is 1 edit; a shared change is 1 edit; a divergent one is 2 (the new flag, and the call that sets it).
//         every divergent change adds one flag, and the flags can combine: 2^flags paths.
// shared core: extracting the core is 1 edit; every change is 1 edit, in the core or in one edge.
const N = 20;
function year(pct, design) {
  const d = (N * pct) / 100, s = N - d;
  if (design === 'copy') return { edits: 2 * s + d, flags: 0, paths: 1, risk: s };
  if (design === 'merged') return { edits: 1 + s + 2 * d, flags: d, paths: 2 ** d, risk: d };
  return { edits: 1 + N, flags: 0, paths: 1, risk: 0 };
}
for (const pct of [0, 25, 50, 75, 100]) {
  const row = ['copy', 'merged', 'core'].map((x) => {
    const r = year(pct, x);
    return `${x} ${r.edits} edits, ${r.flags} flags, ${r.paths} paths, ${r.risk} risk`;
  });
  console.log(`${pct}% divergent (${(N * pct) / 100} of ${N}): ${row.join(' | ')}`);
}
