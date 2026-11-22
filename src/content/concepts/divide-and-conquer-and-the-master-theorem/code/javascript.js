// Divide and conquer: merge sort counted in comparisons and element copies, the cost of splitting unevenly,
// the master-theorem recurrence T(n) = a T(n/b) + f(n) evaluated level by level, and work against span (parallel potential).
// Nothing is timed. Look for:
//   - merge sort costs about n log2 n operations, insertion sort (no divide) about n squared / 4 comparisons plus as many moves
//   - a split at a fixed fraction (25%, 10%) is still n log n with a larger constant; peeling off ONE element is quadratic
//   - which level of the recursion tree dominates decides the total: leaves, every level equally, or the root
//   - the sequential merge at the top of the tree limits parallel speed-up (span), long before processors run out

const M = 2147483647; // Park-Miller generator, so every language produces the same numbers

class Rng {
  constructor(seed) { this.s = seed; }
  next() { this.s = (this.s * 48271) % M; return this.s; }
}

function makeData(n) {
  const rng = new Rng(31337);
  const data = [];
  for (let i = 0; i < n; i++) data.push(rng.next() % 100000);
  return data;
}

function ceilLog2(n) {
  let k = 0;
  while (2 ** k < n) k++;
  return k;
}

// Merge sort that splits at pct percent of the list (pct 0 means: peel off exactly one element).
// Counts: comparisons while merging, copies (every element is written once per merge), deepest recursion.
function mergeSort(a, pct) {
  const stats = { cmp: 0, copy: 0, depth: 0 };
  function sort(xs, depth) {
    stats.depth = Math.max(stats.depth, depth);
    const n = xs.length;
    if (n <= 1) return xs;
    const leftN = pct === 0 ? 1 : Math.max(1, Math.min(n - 1, Math.floor((n * pct) / 100)));
    const left = sort(xs.slice(0, leftN), depth + 1), right = sort(xs.slice(leftN), depth + 1);
    const out = [];
    let i = 0, j = 0;
    while (i < left.length && j < right.length) {
      stats.cmp++;
      if (left[i] <= right[j]) out.push(left[i++]);
      else out.push(right[j++]);
    }
    while (i < left.length) out.push(left[i++]);
    while (j < right.length) out.push(right[j++]);
    stats.copy += n;
    return out;
  }
  const result = sort([...a], 1);
  return { result, stats };
}

function insertionSort(a) {
  const xs = [...a];
  let cmp = 0, moves = 0;
  for (let i = 1; i < xs.length; i++) {
    const v = xs[i];
    let j = i - 1;
    while (j >= 0) {
      cmp++;
      if (xs[j] > v) { xs[j + 1] = xs[j]; moves++; j--; }
      else break;
    }
    xs[j + 1] = v;
  }
  return { cmp, moves };
}

console.log("-- merge sort (split in half): comparisons + copies against n * ceil(log2 n)");
for (const n of [10, 100, 1000, 10000, 100000]) {
  const data = makeData(n);
  const { result, stats } = mergeSort(data, 50);
  const sorted = [...data].sort((x, y) => x - y);
  if (result.some((v, i) => v !== sorted[i])) throw new Error("not sorted");
  console.log(`  n=${n}: ${stats.cmp} comparisons + ${stats.copy} copies = ${stats.cmp + stats.copy}, n*ceil(log2 n) = ${n * ceilLog2(n)}, depth ${stats.depth}`);
}
console.log("-- no divide: insertion sort on the same data (comparisons + moves)");
for (const n of [10, 100, 1000]) {
  const { cmp, moves } = insertionSort(makeData(n));
  console.log(`  n=${n}: ${cmp} comparisons + ${moves} moves = ${cmp + moves}`);
}

console.log("-- merge sort with an uneven split: total operations (comparisons + copies) and recursion depth");
for (const n of [100, 1000, 2000]) {
  const row = [];
  for (const [label, pct] of [["50%", 50], ["25%", 25], ["10%", 10], ["one element", 0]]) {
    const { stats } = mergeSort(makeData(n), pct);
    row.push(`${label}: ${stats.cmp + stats.copy} ops, depth ${stats.depth}`);
  }
  console.log(`  n=${n}: ${row.join("; ")}`);
}

// ---- Recurrence T(n) = a T(n/b) + f(n), with T(1) = 1, for n = b^k, evaluated level by level ----
const fOf = (kind, m) => (kind === "1" ? 1 : kind === "n" ? m : m * m);
const F_EXP = { "1": 0, n: 1, n2: 2 };
const CASES = [
  ["merge sort", 2, 2, "n"],
  ["binary search", 1, 2, "1"],
  ["tree sum", 2, 2, "1"],
  ["split in 4, combine in n", 4, 2, "n"],
  ["expensive combine n^2", 2, 2, "n2"],
  ["naive matrix multiply", 8, 2, "n2"],
  ["Strassen", 7, 2, "n2"],
];

function recurrence(a, b, kind, k) {
  const n = b ** k;
  const levels = [];
  for (let i = 0; i < k; i++) levels.push(a ** i * fOf(kind, n / b ** i));
  const leaves = a ** k;
  return { total: levels.reduce((s, x) => s + x, 0) + leaves, root: levels[0], leaves };
}

function verdict(a, b, kind) {
  const c = F_EXP[kind];
  if (a > b ** c) return "leaves dominate";
  if (a === b ** c) return "every level costs the same";
  return "root dominates";
}

console.log("-- recurrence T(n) = a T(n/b) + f(n), total work, cost of the root level, cost of the leaf level");
for (const k of [10, 16]) {
  console.log(`  n = 2^${k} = ${2 ** k}`);
  for (const [name, a, b, kind] of CASES) {
    const { total, root, leaves } = recurrence(a, b, kind, k);
    console.log(`    ${name} (a=${a}, b=${b}, f=${kind}): total ${total}, root level ${root}, leaf level ${leaves}: ${verdict(a, b, kind)}`);
  }
}

// ---- Work and span of merge sort (model, n = 2^k) ----
const work = (k) => recurrence(2, 2, "n", k).total;
const spanSequentialMerge = (k) => 2 ** (k + 1) - 1; // S(n) = S(n/2) + n, S(1) = 1
const spanParallelMerge = (k) => { let s = 1; for (let j = 1; j <= k; j++) s += j * j; return s; }; // model: merging m items has span (ceil log2 m)^2

console.log("-- parallel potential of merge sort: work, span, and the best possible time on p workers");
for (const k of [10, 20]) {
  const w = work(k), s1 = spanSequentialMerge(k), s2 = spanParallelMerge(k);
  console.log(`  n = 2^${k}: work ${w}; sequential merge: span ${s1}, parallelism ${Math.floor(w / s1)}; parallel merge (model): span ${s2}, parallelism ${Math.floor(w / s2)}`);
  for (const p of [4, 16, 64, 1024]) {
    const wp = Math.ceil(w / p);
    console.log(`    p=${p}: sequential merge at least ${Math.max(wp, s1)} steps, parallel merge at least ${Math.max(wp, s2)} steps (work/p = ${wp})`);
  }
}
