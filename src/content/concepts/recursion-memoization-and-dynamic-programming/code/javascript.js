// Naive recursion vs memoization vs bottom-up tabulation, counted in function calls, cache entries and stack depth.
// Every problem is described by one function: given a state (an integer key), which sub-states does it call?
// Look for: naive calls explode with n while memoized calls grow in step with the number of distinct states;
// the tree sum has NO overlapping subproblems, so its cache is pure overhead; greedy gives wrong coin answers.
const CAP = 1e15; // naive counts above this are reported as "more than 1e15" (they still fit in 53-bit integers)

const fib = () => ({ start: (n) => n, children: (k) => (k < 2 ? [] : [k - 1, k - 2]), cells: (n) => n + 1 });
// A grid state is r*1000 + c: paths from (r,c) to the edge (r=0 or c=0), moving up or left one step at a time.
const grid = () => ({ start: (n) => n * 1000 + n, children: (k) => (Math.floor(k / 1000) === 0 || k % 1000 === 0 ? [] : [k - 1000, k - 1]), cells: (n) => (n + 1) * (n + 1) });
// Fewest coins for an amount: every coin that fits is a sub-call.
const coins = (set) => ({ start: (n) => n, children: (a) => (a === 0 ? [] : set.filter((c) => c <= a).map((c) => a - c)), cells: (n) => n + 1 });
// Same problem, but the cache key also holds "coins used so far" (key = amount*1000 + used): too much state in the key.
const coinsBadKey = (set) => ({
  start: (n) => n * 1000,
  children: (k) => { const a = Math.floor(k / 1000), u = k % 1000; return a === 0 ? [] : set.filter((c) => c <= a).map((c) => (a - c) * 1000 + u + 1); },
  cells: (n) => n + 1,
});
// A complete binary tree of the given depth, nodes numbered like a heap (root 1, children 2i and 2i+1): summing it never revisits a node.
const tree = () => ({ start: () => 1, children: (i, depth) => (Math.floor(Math.log2(i)) >= depth ? [] : [2 * i, 2 * i + 1]), cells: (d) => 2 ** (d + 1) - 1 });

// Calls made by the NAIVE recursion, without running it: calls(state) = 1 + sum of calls(children), with a table
// so that 2^n calls are never executed. Saturates at CAP.
function naive(p, n) {
  const memo = new Map();
  const calls = (k) => {
    if (memo.has(k)) return memo.get(k);
    let total = 1;
    for (const c of p.children(k, n)) total = Math.min(CAP, total + calls(c));
    memo.set(k, total);
    return total;
  };
  return calls(p.start(n));
}
// Longest chain of nested calls (stack frames) of the recursion, same table trick.
function depth(p, n) {
  const memo = new Map();
  const d = (k) => {
    if (memo.has(k)) return memo.get(k);
    let best = 0;
    for (const c of p.children(k, n)) best = Math.max(best, d(c));
    memo.set(k, best + 1);
    return best + 1;
  };
  return d(p.start(n));
}
// The memoized recursion, really executed: a call that finds its key in the cache returns at once.
function memoized(p, n) {
  const cache = new Set();
  let calls = 0;
  const f = (k) => {
    calls++;
    if (cache.has(k)) return;
    for (const c of p.children(k, n)) f(c);
    cache.add(k);
  };
  f(p.start(n));
  return { calls, entries: cache.size };
}
// The naive recursion, really executed, to check that the counting model above is exact.
function runNaive(p, n) {
  let calls = 0;
  const f = (k) => { calls++; for (const c of p.children(k, n)) f(c); };
  f(p.start(n));
  return calls;
}
const fmt = (x) => (x >= CAP ? 'more than 1e15' : String(x));

function report(label, p, sizes) {
  console.log(`-- ${label}`);
  for (const n of sizes) {
    const m = memoized(p, n);
    console.log(`  n=${n}: naive ${fmt(naive(p, n))} calls, memoized ${m.calls} calls and ${m.entries} entries, bottom-up ${p.cells(n)} cells, stack depth ${depth(p, n)}`);
  }
}
report('Fibonacci', fib(), [10, 20, 30, 40]);
report('Grid paths, n x n', grid(), [4, 8, 12, 16]);
report('Coin change {1,5,10,25}', coins([1, 5, 10, 25]), [30, 60, 90]);
report('Coin change {1,5,10,25} with a bad cache key (amount, coins used)', coinsBadKey([1, 5, 10, 25]), [30, 60]);
report('Sum of a complete tree of depth n (nothing overlaps)', tree(), [5, 10, 15]);

console.log('-- the model is exact: running the naive recursion gives the same count');
for (const [label, p, n] of [['fib 20', fib(), 20], ['grid 8', grid(), 8], ['coins 40', coins([1, 5, 10, 25]), 40], ['tree 10', tree(), 10]]) {
  const ran = runNaive(p, n), modelled = naive(p, n);
  console.log(`  ${label}: run ${ran}, model ${modelled}, ${ran === modelled ? 'same' : 'DIFFERENT'}`);
}

// Smallest n where the naive recursion needs more than one billion calls.
function billion(p, limit) {
  for (let n = 1; n <= limit; n++) if (naive(p, n) > 1e9) return n;
  return -1;
}
console.log('-- first n where naive recursion passes 1,000,000,000 calls');
console.log(`  Fibonacci: n=${billion(fib(), 100)}`);
console.log(`  Grid paths: n=${billion(grid(), 40)}`);
console.log(`  Coins {1,5,10,25}: amount=${billion(coins([1, 5, 10, 25]), 500)}`);
console.log(`  Coins {1,3,4}: amount=${billion(coins([1, 3, 4]), 500)}`);
let treeDepth = 1;
while (2 ** (treeDepth + 1) - 1 <= 1e9) treeDepth++;
console.log(`  Tree: depth=${treeDepth}`);

// Greedy (take the biggest coin that fits) against the optimum (bottom-up table).
function greedy(set, amount) {
  let left = amount, used = 0;
  for (const c of [...set].sort((a, b) => b - a)) { used += Math.floor(left / c); left %= c; }
  return used;
}
function best(set, amount) {
  const t = [0];
  for (let a = 1; a <= amount; a++) { t[a] = Infinity; for (const c of set) if (c <= a) t[a] = Math.min(t[a], t[a - c] + 1); }
  return t[amount];
}
console.log('-- greedy against optimal');
for (const [set, amount] of [[[1, 5, 10, 25], 63], [[1, 3, 4], 6], [[1, 7, 10], 14], [[1, 5, 12], 15]]) {
  const g = greedy(set, amount), o = best(set, amount);
  console.log(`  coins {${set.join(',')}} amount ${amount}: greedy ${g}, optimal ${o}${g === o ? '' : ' (greedy is wrong)'}`);
}
