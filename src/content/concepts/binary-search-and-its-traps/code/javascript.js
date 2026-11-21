// Binary search, counted in probes (one probe = one look at an item), never in time.
// Look for: halving needs about log2 n probes where a scan needs up to n; the textbook "find any match" version returns
// SOME copy of a duplicated value, not the first; the "lo = mid" off-by-one hangs only on some inputs; a 32-bit
// "(lo + hi) / 2" goes negative once the range is big; and the same halving works on an answer space, no array needed.
// The list is never built: item i of the sorted list is floor(i / run) * 2 + 1, so every value appears `run` times (odd values only).

const CAP = 64; // the buggy search is stopped after this many probes, so the program still ends
const half = (x) => Math.floor(x / 2);

const at = (i, run) => Math.floor(i / run) * 2 + 1;
const firstIndex = (v, run) => half(v - 1) * run;

// Scans from the left and stops at the first match, so it also finds the first occurrence.
function linear(n, run, t) {
  for (let i = 0; i < n; i++) if (at(i, run) === t) return [i + 1, i];
  return [n, -1];
}

// Textbook version: stop at the first probe that hits the target.
function binaryAny(n, run, t) {
  let lo = 0, hi = n - 1, probes = 0;
  while (lo <= hi) {
    const mid = lo + half(hi - lo);
    probes++;
    const v = at(mid, run);
    if (v === t) return [probes, mid];
    if (v < t) lo = mid + 1; else hi = mid - 1;
  }
  return [probes, -1];
}

// Half-open range [lo, hi): keeps halving until it finds the first position whose value is >= t, then checks it (one more probe).
function lowerBound(n, run, t) {
  let lo = 0, hi = n, probes = 0;
  while (lo < hi) {
    const mid = lo + half(hi - lo);
    probes++;
    if (at(mid, run) < t) lo = mid + 1; else hi = mid;
  }
  probes++;
  return lo < n && at(lo, run) === t ? [probes, lo] : [probes, -1];
}

// "lo = mid" instead of "lo = mid + 1": when lo and hi are neighbours, mid == lo and nothing changes. Returns [probes, stuck].
function buggy(n, run, t) {
  let lo = 0, hi = n - 1, probes = 0;
  while (lo < hi && probes < CAP) {
    const mid = lo + half(hi - lo);
    probes++;
    if (at(mid, run) < t) lo = mid; else hi = mid;
  }
  return [probes, lo < hi];
}

console.log("-- probes to find a target in a sorted list of n items, each value repeated `run` times");
for (const run of [1, 4]) {
  for (const n of [10, 1000, 1000000]) {
    for (const [name, t] of [["first", at(0, run)], ["last", at(n - 1, run)], ["middle", at(half(n), run)], ["missing", 2]]) {
      const [lc, lp] = linear(n, run, t);
      const [bc, bp] = binaryAny(n, run, t);
      const [oc, op] = lowerBound(n, run, t);
      const [gc, stuck] = buggy(n, run, t);
      const first = lp >= 0 ? firstIndex(t, run) : -1;
      const ok = bp < 0 ? "not found" : bp === first ? "first copy" : "a later copy";
      const g = stuck ? `stuck, gave up at ${gc} probes` : `${gc} probes`;
      console.log(`run=${run} n=${n} ${name}: linear ${lc}, binary-any ${bc} (index ${bp}, ${ok}), lower-bound ${oc} (index ${op}), lo=mid bug: ${g}`);
    }
  }
}

console.log("-- the midpoint in 32-bit signed integers");
for (const [lo, hi] of [[1000000000, 1100000000], [1500000000, 2000000000], [2000000000, 2100000000]]) {
  const s = (lo + hi) | 0; // what a 32-bit signed int holds: the sum wraps around
  console.log(`lo=${lo} hi=${hi}: (lo + hi) is ${s}, naive mid ${half(s)}, safe mid ${lo + half(hi - lo)}`);
}

const weight = (i) => 1 + ((i * 37 + 11) % 20);

function daysNeeded(n, cap) {
  let days = 1, load = 0;
  for (let i = 0; i < n; i++) {
    const w = weight(i);
    if (load + w > cap) { days++; load = 0; }
    load += w;
  }
  return days;
}

console.log("-- searching an answer space: the smallest ship capacity that moves n packages, in order, within D days");
for (const n of [100, 1000]) {
  for (const d of [3, 10]) {
    let heaviest = 0, total = 0;
    for (let i = 0; i < n; i++) { heaviest = Math.max(heaviest, weight(i)); total += weight(i); }
    let lo = heaviest, hi = total, probes = 0;
    while (lo < hi) {
      const mid = lo + half(hi - lo);
      probes++;
      if (daysNeeded(n, mid) <= d) hi = mid; else lo = mid + 1;
    }
    const tries = lo - heaviest + 1;
    console.log(`n=${n} days=${d}: capacity ${lo} (searched ${heaviest} to ${total}), binary ${probes} checks = ${probes * n} steps, counting up from ${heaviest}: ${tries} checks = ${tries * n} steps`);
  }
}
