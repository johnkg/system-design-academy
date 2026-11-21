// Choosing a data structure: six structures run the same workload, and we count steps (element visits, comparisons, element moves).
// Look for: no structure wins every operation. The hash map has the cheapest lookup but must visit everything for a range; the sorted
// array has cheap range and smallest but pays for every insert; the heap only knows its smallest; the tree is never the worst.
// Counts are an explicit model: one step is one element visit, comparison, write or element shifted. Shifting the elements after an insert
// into an array is counted by length, because a real array does it with one bulk copy, which is typically much cheaper per element.
let ops = 0;
const SPACE = 1000003; // keys are distinct integers below this prime: key(i) = (i * 7919 + 13) % SPACE
const key = (i) => (i * 7919 + 13) % SPACE;

class UnsortedArray {
  constructor(keys) { this.a = keys.slice(); }
  lookup(k) { for (const x of this.a) { ops++; if (x === k) return 1; } return 0; }
  insert(k) { ops++; this.a.push(k); }
  range(lo, hi) { let found = 0; for (const x of this.a) { ops++; if (lo <= x && x < hi) found++; } return found; }
  smallest() { let best = this.a[0]; for (const x of this.a) { ops++; best = Math.min(best, x); } return best; }
}

class SortedArray {
  constructor(keys) { this.s = keys.slice().sort((x, y) => x - y); }
  lowerBound(k) { // binary search, one comparison per halving
    let lo = 0, hi = this.s.length;
    while (lo < hi) {
      ops++;
      const mid = Math.floor((lo + hi) / 2);
      if (this.s[mid] < k) lo = mid + 1; else hi = mid;
    }
    return lo;
  }
  lookup(k) { const i = this.lowerBound(k); ops++; return i < this.s.length && this.s[i] === k ? 1 : 0; }
  insert(k) {
    const i = this.lowerBound(k);
    ops += 1 + this.s.length - i; // the write, plus every later element shifted one place
    this.s.splice(i, 0, k);
  }
  range(lo, hi) {
    let i = this.lowerBound(lo), found = 0;
    while (i < this.s.length) { ops++; if (this.s[i] >= hi) break; found++; i++; }
    return found;
  }
  smallest() { ops++; return this.s[0]; }
}

class ListNode { constructor(k, next) { this.k = k; this.next = next; } }

class LinkedList {
  constructor(keys) { this.head = null; for (const k of keys) this.head = new ListNode(k, this.head); }
  lookup(k) { for (let n = this.head; n; n = n.next) { ops++; if (n.k === k) return 1; } return 0; }
  insert(k) { ops++; this.head = new ListNode(k, this.head); }
  range(lo, hi) { let found = 0; for (let n = this.head; n; n = n.next) { ops++; if (lo <= n.k && n.k < hi) found++; } return found; }
  smallest() { let best = this.head.k; for (let n = this.head; n; n = n.next) { ops++; best = Math.min(best, n.k); } return best; }
}

class HashMap { // chained buckets, sized once for the data it will hold (no resizing is counted)
  constructor(keys, buckets) {
    this.b = buckets;
    this.t = Array.from({ length: buckets }, () => []);
    this.count = 0;
    for (const k of keys) { this.t[k % this.b].push(k); this.count++; }
  }
  lookup(k) { ops++; for (const x of this.t[k % this.b]) { ops++; if (x === k) return 1; } return 0; }
  insert(k) {
    ops++;
    const chain = this.t[k % this.b];
    for (let i = 0; i < chain.length; i++) ops++; // a map must check that the key is not already there
    chain.push(k);
    this.count++;
  }
  range(lo, hi) { // no order: visit every bucket and every element
    ops += this.b + this.count;
    let found = 0;
    for (const chain of this.t) for (const x of chain) if (lo <= x && x < hi) found++;
    return found;
  }
  smallest() {
    ops += this.b + this.count;
    let best = Infinity;
    for (const chain of this.t) for (const x of chain) best = Math.min(best, x);
    return best;
  }
}

class AvlNode { constructor(k) { this.k = k; this.l = null; this.r = null; this.h = 1; } }
const height = (n) => (n ? n.h : 0);
const update = (n) => { n.h = 1 + Math.max(height(n.l), height(n.r)); };
function rotRight(y) { ops++; const x = y.l; y.l = x.r; x.r = y; update(y); update(x); return x; }
function rotLeft(x) { ops++; const y = x.r; x.r = y.l; y.l = x; update(x); update(y); return y; }
function avlInsert(n, k) {
  ops++; // one node visited, or the new node written
  if (n === null) return new AvlNode(k);
  if (k < n.k) n.l = avlInsert(n.l, k); else n.r = avlInsert(n.r, k);
  update(n);
  const bal = height(n.l) - height(n.r);
  if (bal > 1) {
    if (height(n.l.l) < height(n.l.r)) n.l = rotLeft(n.l);
    return rotRight(n);
  }
  if (bal < -1) {
    if (height(n.r.r) < height(n.r.l)) n.r = rotRight(n.r);
    return rotLeft(n);
  }
  return n;
}

class BalancedTree { // an AVL tree
  constructor(keys) { this.root = null; for (const k of keys) this.root = avlInsert(this.root, k); }
  lookup(k) {
    for (let n = this.root; n;) { ops++; if (k === n.k) return 1; n = k < n.k ? n.l : n.r; }
    return 0;
  }
  insert(k) { this.root = avlInsert(this.root, k); }
  range(lo, hi) { // in-order walk that skips subtrees outside the range
    let found = 0;
    const walk = (n) => {
      if (n === null) return;
      ops++;
      if (lo < n.k) walk(n.l);
      if (lo <= n.k && n.k < hi) found++;
      if (n.k < hi) walk(n.r);
    };
    walk(this.root);
    return found;
  }
  smallest() { let n = this.root; while (n.l) { ops++; n = n.l; } ops++; return n.k; }
}

class MinHeap { // array-based binary heap: knows its smallest, nothing else
  constructor(keys) { this.h = []; for (const k of keys) this.insert(k); }
  lookup(k) { for (const x of this.h) { ops++; if (x === k) return 1; } return 0; }
  insert(k) {
    ops++;
    this.h.push(k);
    let i = this.h.length - 1;
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      ops++;
      if (this.h[p] > this.h[i]) { [this.h[p], this.h[i]] = [this.h[i], this.h[p]]; i = p; } else break;
    }
  }
  range(lo, hi) { let found = 0; for (const x of this.h) { ops++; if (lo <= x && x < hi) found++; } return found; }
  smallest() { ops++; return this.h[0]; }
}

const STRUCTURES = [["unsorted array", UnsortedArray, 1], ["sorted array", SortedArray, 1], ["linked list", LinkedList, 2],
  ["hash map", HashMap, 1], ["balanced tree", BalancedTree, 2], ["binary heap", MinHeap, 1]]; // third field: 2 = follows pointers

function run(Cls, n, lookups, inserts, ranges, smallests) { // returns [steps for lookups, inserts, ranges, smallest queries, key results found]
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(key(i));
  const s = new Cls(keys, 2 * (n + inserts) + 1);
  let found = 0;
  ops = 0;
  for (let t = 0; t < lookups; t++) found += s.lookup(key((t * 37 + 11) % n));
  const lk = ops;
  ops = 0;
  const width = Math.floor(10 * SPACE / n); // about 10 keys fall in a range this wide
  for (let t = 0; t < ranges; t++) {
    const lo = (t * 104729) % SPACE;
    found += s.range(lo, lo + width);
  }
  const rg = ops;
  ops = 0;
  for (let t = 0; t < smallests; t++) found += s.smallest() >= 0 ? 1 : 0;
  const sm = ops;
  ops = 0;
  for (let t = 0; t < inserts; t++) s.insert(key(n + t));
  const ins = ops;
  return [lk, ins, rg, sm, found];
}

const MIXES = [["lookup-heavy", 1000, 10, 0, 0], ["insert-heavy", 10, 1000, 0, 0], ["range reports", 20, 5, 500, 0],
  ["priority queue", 0, 500, 0, 500], ["mixed", 200, 200, 200, 200]];
const fewest = (totals) => totals.indexOf(Math.min(...totals));

let agree = true;
for (const n of [100, 1000, 10000]) {
  console.log(`n=${n}, 100 of each operation:`);
  const founds = new Set();
  for (const [name, Cls] of STRUCTURES) {
    const [lk, ins, rg, sm, found] = run(Cls, n, 100, 100, 100, 100);
    founds.add(found);
    console.log(`  ${name}: lookup ${lk}, insert ${ins}, range ${rg}, smallest ${sm}, total ${lk + ins + rg + sm}`);
  }
  agree = agree && founds.size === 1;
}
console.log(`all six structures return the same results: ${agree ? "yes" : "no"}`);

for (const [mix, l, i, r, m] of MIXES) {
  const totals = STRUCTURES.map(([, Cls]) => { const [lk, ins, rg, sm] = run(Cls, 1000, l, i, r, m); return lk + ins + rg + sm; });
  const cells = STRUCTURES.map(([name], x) => `${name} ${totals[x]}`).join(", ");
  console.log(`${mix} (${l} lookups, ${i} inserts, ${r} ranges, ${m} smallest) at n=1000: ${cells}; fewest steps: ${STRUCTURES[fewest(totals)][0]}`);
}

// Cache caveat: counts treat every step alike. If following a pointer costs 4 times an array step, the range-reports mix changes.
const weighted = STRUCTURES.map(([, Cls, pointer]) => { const [lk, ins, rg, sm] = run(Cls, 1000, 20, 5, 500, 0); return (lk + ins + rg + sm) * (pointer === 2 ? 4 : 1); });
console.log("range reports at n=1000 with pointer steps weighted 4: " + STRUCTURES.map(([name], x) => `${name} ${weighted[x]}`).join(", ") + `; fewest: ${STRUCTURES[fewest(weighted)][0]}`);
