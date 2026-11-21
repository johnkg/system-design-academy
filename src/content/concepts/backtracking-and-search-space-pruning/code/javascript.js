// Backtracking with and without pruning, counted in search nodes visited (one node = one call of the recursive search).
// Two classic problems:
//   N-queens: place n queens on an n x n board so that none attacks another (rows, columns, diagonals)
//   subset sum: count the subsets of a list of positive integers that add up to a target
// Look for: the same answers from every variant, but node counts that differ by factors of thousands;
// an ordering heuristic that changes how soon the FIRST answer is found but not the work to find ALL of them;
// and an input on which pruning helps much less, because backtracking is still exponential in the worst case.

const M = 2147483647; // Park-Miller generator, so every language produces the same numbers

class Rng {
  constructor(seed) { this.s = seed; }
  next() { this.s = (this.s * 48271) % M; return this.s; }
}

// ---- N-queens ----

// No pruning: choose a column for every row (n to the power n boards), look at the board only when it is full.
function queensGenerateAndTest(n) {
  const cols = new Array(n).fill(0);
  let nodes = 0, solutions = 0;
  const ok = () => {
    for (let r = 0; r < n; r++)
      for (let s = r + 1; s < n; s++)
        if (cols[r] === cols[s] || Math.abs(cols[r] - cols[s]) === s - r) return false;
    return true;
  };
  const place = (row) => {
    nodes++;
    if (row === n) { if (ok()) solutions++; return; }
    for (let c = 0; c < n; c++) { cols[row] = c; place(row + 1); }
  };
  place(0);
  return [solutions, nodes];
}

// Weak pruning: never reuse a column (n! boards), but still look at the diagonals only when the board is full.
function queensPermutations(n) {
  const cols = new Array(n).fill(0);
  const used = new Array(n).fill(false);
  let nodes = 0, solutions = 0;
  const ok = () => {
    for (let r = 0; r < n; r++)
      for (let s = r + 1; s < n; s++)
        if (Math.abs(cols[r] - cols[s]) === s - r) return false;
    return true;
  };
  const place = (row) => {
    nodes++;
    if (row === n) { if (ok()) solutions++; return; }
    for (let c = 0; c < n; c++) {
      if (!used[c]) { used[c] = true; cols[row] = c; place(row + 1); used[c] = false; }
    }
  };
  place(0);
  return [solutions, nodes];
}

function columnOrder(n, middleFirst) {
  const cols = Array.from({ length: n }, (_, i) => i);
  if (middleFirst) cols.sort((a, b) => Math.abs(2 * a - (n - 1)) - Math.abs(2 * b - (n - 1)) || a - b);
  return cols;
}

// Full pruning: a square attacked by an earlier queen is never tried, so the search never goes below a dead end.
function queensPruned(n, middleFirst = false, firstOnly = false) {
  const order = columnOrder(n, middleFirst);
  const colUsed = new Array(n).fill(false);
  const diag1 = new Array(2 * n).fill(false); // row + col
  const diag2 = new Array(2 * n).fill(false); // row - col + n
  let nodes = 0, solutions = 0;
  const place = (row) => {
    nodes++;
    if (row === n) { solutions++; return firstOnly; }
    for (const c of order) {
      if (colUsed[c] || diag1[row + c] || diag2[row - c + n]) continue;
      colUsed[c] = diag1[row + c] = diag2[row - c + n] = true;
      const stop = place(row + 1);
      colUsed[c] = diag1[row + c] = diag2[row - c + n] = false;
      if (stop) return true;
    }
    return false;
  };
  place(0);
  return [solutions, nodes];
}

// Nodes of a full tree with n levels and n children per node: n^0 + n^1 + ... + n^n.
function powerSum(n) {
  let total = 0n;
  for (let k = 0; k <= n; k++) total += BigInt(n) ** BigInt(k);
  return total.toString();
}

console.log("-- N-queens: search nodes visited to find ALL solutions");
for (const n of [4, 5, 6]) {
  const [s1, n1] = queensGenerateAndTest(n), [s2, n2] = queensPermutations(n), [s3, n3] = queensPruned(n);
  console.log(`  n=${n}: ${s3} solutions; every board ${n1} nodes, no repeated column ${n2} nodes, pruned ${n3} nodes; all agree: ${s1 === s2 && s2 === s3 ? "True" : "False"}`);
}
for (const n of [7, 8]) {
  const [s2, n2] = queensPermutations(n), [s3, n3] = queensPruned(n);
  console.log(`  n=${n}: ${s3} solutions; every board ${powerSum(n)} nodes (counted by formula), no repeated column ${n2} nodes, pruned ${n3} nodes; agree: ${s2 === s3 ? "True" : "False"}`);
}
for (const n of [9, 10, 11]) {
  const [s3, n3] = queensPruned(n);
  console.log(`  n=${n}: ${s3} solutions; every board ${powerSum(n)} nodes (formula), pruned ${n3} nodes`);
}

console.log("-- N-queens: nodes visited to find only the FIRST solution, by column order");
for (const n of [8, 12, 16, 20, 24]) {
  const a = queensPruned(n, false, true), b = queensPruned(n, true, true);
  console.log(`  n=${n}: left to right ${a[1]} nodes, middle first ${b[1]} nodes`);
}

console.log("-- N-queens: nodes to find ALL solutions, whatever the column order (the order only moves WHERE the solutions are)");
for (const n of [8, 10]) {
  console.log(`  n=${n}: left to right ${queensPruned(n)[1]} nodes, middle first ${queensPruned(n, true)[1]} nodes`);
}

// ---- Subset sum ----

function makeItems(n) {
  const rng = new Rng(4242);
  const items = [];
  for (let i = 0; i < n; i++) items.push(1 + (rng.next() % 50));
  return items;
}

// No pruning: every item is either in or out (2 to the power n leaves).
function subsetPlain(items, target) {
  let nodes = 0, count = 0;
  const go = (i, total) => {
    nodes++;
    if (i === items.length) { if (total === target) count++; return; }
    go(i + 1, total);
    go(i + 1, total + items[i]);
  };
  go(0, 0);
  return [count, nodes];
}

// Prune when the running total passes the target, or when even taking every remaining item cannot reach it.
function subsetPruned(items, target, descending) {
  const seq = descending ? [...items].sort((a, b) => b - a) : [...items];
  const suffix = new Array(seq.length + 1).fill(0);
  for (let i = seq.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + seq[i];
  let nodes = 0, count = 0;
  const go = (i, total) => {
    nodes++;
    if (total > target || total + suffix[i] < target) return;
    if (i === seq.length) { count++; return; }
    go(i + 1, total + seq[i]);
    go(i + 1, total);
  };
  go(0, 0);
  return [count, nodes];
}

console.log("-- subset sum: how many subsets add up to half of the total (nodes visited)");
for (const n of [10, 16, 20]) {
  const items = makeItems(n);
  const target = Math.floor(items.reduce((a, b) => a + b, 0) / 2);
  const [c0, n0] = subsetPlain(items, target), [c1, n1] = subsetPruned(items, target, false), [c2, n2] = subsetPruned(items, target, true);
  console.log(`  n=${n}: target ${target}, ${c0} subsets; no pruning ${n0} nodes, pruned in given order ${n1}, pruned largest first ${n2}; all agree: ${c0 === c1 && c1 === c2 ? "True" : "False"}`);
}
console.log("-- subset sum with pruning only (no pruning would visit 2^(n+1) - 1 nodes)");
for (const n of [24]) {
  const items = makeItems(n);
  const target = Math.floor(items.reduce((a, b) => a + b, 0) / 2);
  const [c2, n2] = subsetPruned(items, target, true);
  console.log(`  n=${n}: ${c2} subsets, pruned largest first ${n2} nodes, against ${2 ** (n + 1) - 1} without pruning`);
}
console.log("-- a bad case for pruning: n items all equal to 2 and an odd target of n + 1 (no subset works)");
for (const n of [16, 20]) {
  const items = new Array(n).fill(2);
  const target = n % 2 === 0 ? n + 1 : n;
  const [c, nodes] = subsetPruned(items, target, true);
  console.log(`  n=${n}: ${c} subsets, ${nodes} nodes pruned, against ${2 ** (n + 1) - 1} without pruning`);
}
