// A binary min-heap (a priority queue stored in a flat array), with every comparison counted instead of timed.
// Look for: building a heap bottom-up costs under 2n comparisons where pushing one at a time costs up to n log n; top-k
// with a heap of size k beats a full sort when k is small and loses its edge when k is large; an array kept sorted or
// unsorted makes one of push and pop cost O(n); decrease-key needs to know where an item is; a priority that never ages starves.
// A "step" is one element examined (compared, and maybe moved). The lists come from a fixed integer generator.

const ID_SPACE = 100000; // a heap entry is priority * ID_SPACE + id, so equal priorities are ordered by id and every key is unique

function makeInput(pattern, n) {
  const a = [];
  let x = 12345;
  for (let i = 0; i < n; i++) {
    x = (x * 1664525 + 1013904223) % 4294967296;
    const r = Math.floor(x / 65536) % 100000;
    a.push(pattern === "descending" ? n - i : pattern === "ascending" ? i + 1 : r);
  }
  return a;
}

class Heap {
  constructor(trackPositions = 0) {
    this.a = [];
    this.c = 0; // comparisons so far
    this.pos = trackPositions ? new Array(trackPositions).fill(0) : null; // where each id sits, for decrease-key
  }
  put(i, key) {
    this.a[i] = key;
    if (this.pos) this.pos[key % ID_SPACE] = i;
  }
  siftUp(i) {
    const key = this.a[i];
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      this.c++;
      if (key < this.a[p]) { this.put(i, this.a[p]); i = p; } else break;
    }
    this.put(i, key);
  }
  siftDown(i) {
    const key = this.a[i], n = this.a.length;
    for (;;) {
      let s = 2 * i + 1;
      if (s >= n) break;
      if (s + 1 < n) {
        this.c++;
        if (this.a[s + 1] < this.a[s]) s++;
      }
      this.c++;
      if (this.a[s] < key) { this.put(i, this.a[s]); i = s; } else break;
    }
    this.put(i, key);
  }
  push(key) {
    this.a.push(key);
    this.siftUp(this.a.length - 1);
  }
  pop() {
    const top = this.a[0], last = this.a.pop();
    if (this.a.length > 0) { this.a[0] = last; this.siftDown(0); }
    return top;
  }
  // bottom-up: sift down every parent, last parent first
  heapify(items) {
    this.a = items.slice();
    if (this.pos) this.a.forEach((key, i) => { this.pos[key % ID_SPACE] = i; });
    for (let i = Math.floor(this.a.length / 2) - 1; i >= 0; i--) this.siftDown(i);
  }
}

function mergeSortCount(a) {
  let count = 0;
  const sort = (v) => {
    if (v.length < 2) return v;
    const left = sort(v.slice(0, Math.floor(v.length / 2))), right = sort(v.slice(Math.floor(v.length / 2)));
    const out = [];
    let i = 0, j = 0;
    while (i < left.length && j < right.length) {
      count++;
      if (right[j] < left[i]) out.push(right[j++]); else out.push(left[i++]);
    }
    return out.concat(left.slice(i), right.slice(j));
  };
  sort(a);
  return count;
}

console.log("-- building a heap of n items: n pushes against bottom-up heapify (comparisons)");
for (const n of [10, 100, 1000, 10000]) {
  for (const pattern of ["random", "descending"]) {
    const a = makeInput(pattern, n);
    const h = new Heap();
    for (const v of a) h.push(v);
    const g = new Heap();
    g.heapify(a);
    const per = Math.floor((g.c * 100) / n);
    console.log(`n=${n} ${pattern}: pushes ${h.c}, heapify ${g.c} (${Math.floor(per / 100)}.${String(per % 100).padStart(2, "0")} per item)`);
  }
}

console.log("-- the k largest of n items: a heap of size k against sorting everything (comparisons)");
for (const n of [1000, 10000]) {
  for (const k of [10, 100, n / 2]) {
    const row = [];
    for (const pattern of ["random", "ascending"]) {
      const a = makeInput(pattern, n);
      const h = new Heap();
      h.heapify(a.slice(0, k)); // a min-heap of the k largest so far: its root is the smallest of them
      for (const x of a.slice(k)) {
        h.c++;
        if (x > h.a[0]) { h.a[0] = x; h.siftDown(0); }
      }
      row.push(`${pattern} input ${h.c}`);
    }
    console.log(`n=${n} k=${k}: heap: ${row.join(", ")}; full merge sort ${mergeSortCount(makeInput("random", n))}`);
  }
}

console.log("-- n pushes then n pops, three ways to store a priority queue (steps)");
for (const n of [10, 100, 1000, 10000]) {
  const a = makeInput("random", n);
  let u = [], stepsU = 0; // unsorted array: push is free, pop scans everything for the minimum
  for (const v of a) { u.push(v); stepsU++; }
  while (u.length > 0) {
    stepsU += u.length;
    let m = 0;
    for (let i = 1; i < u.length; i++) if (u[i] < u[m]) m = i; // removing the minimum, written as a scan: len(u) steps
    u.splice(m, 1);
  }
  const s = [];
  let stepsS = 0; // array kept sorted (largest first): insertion shifts items, pop takes the last one
  for (const v of a) {
    s.push(v);
    let j = s.length - 1;
    while (j > 0) {
      stepsS++;
      if (s[j - 1] < v) { s[j] = s[j - 1]; j--; } else break;
    }
    s[j] = v;
  }
  while (s.length > 0) { s.pop(); stepsS++; }
  const h = new Heap();
  for (const v of a) h.push(v);
  while (h.a.length > 0) h.pop();
  console.log(`n=${n}: unsorted array ${stepsU}, sorted array ${stepsS}, heap ${h.c}`);
}

console.log("-- n decrease-key updates, then drain: where is the item?");
const prio = (i) => 20000 + ((i * 7919) % 10007);
const lowered = (i) => prio(i) - 1 - ((i * 4999) % 15000);

for (const n of [100, 1000, 10000]) {
  const start = [];
  for (let i = 0; i < n; i++) start.push(prio(i) * ID_SPACE + i);
  // (a) the heap knows each item's position: change the key and sift it up
  const h = new Heap(n);
  h.heapify(start);
  let base = h.c;
  for (let i = 0; i < n; i++) {
    const j = h.pos[i];
    h.a[j] = lowered(i) * ID_SPACE + i;
    h.siftUp(j);
  }
  const updA = h.c - base;
  const orderA = [];
  while (h.a.length > 0) orderA.push(h.pop() % ID_SPACE);
  const drainA = h.c - base - updA;
  // (b) no position index: scan the array for the item first
  const g = new Heap();
  g.heapify(start);
  base = g.c;
  let scan = 0;
  for (let i = 0; i < n; i++) {
    let j = 0;
    while (g.a[j] % ID_SPACE !== i) j++;
    scan += j + 1;
    g.a[j] = lowered(i) * ID_SPACE + i;
    g.siftUp(j);
  }
  const updB = g.c - base + scan;
  const orderB = [];
  while (g.a.length > 0) orderB.push(g.pop() % ID_SPACE);
  const drainB = g.c - base - (updB - scan);
  // (c) lazy: push a second entry with the new priority, leave the old one, skip stale entries when they surface
  const z = new Heap();
  z.heapify(start);
  base = z.c;
  const current = [];
  for (let i = 0; i < n; i++) current.push(prio(i));
  for (let i = 0; i < n; i++) {
    current[i] = lowered(i);
    z.push(current[i] * ID_SPACE + i);
  }
  const updC = z.c - base, peak = z.a.length;
  const orderC = [], seen = new Array(n).fill(false);
  let stale = 0;
  while (z.a.length > 0) {
    const key = z.pop();
    const i = key % ID_SPACE;
    if (Math.floor(key / ID_SPACE) !== current[i] || seen[i]) stale++;
    else { seen[i] = true; orderC.push(i); }
  }
  const drainC = z.c - base - updC;
  if (orderA.join() !== orderB.join() || orderA.join() !== orderC.join()) throw new Error("the three methods disagree");
  console.log(`n=${n}: indexed ${updA} + ${drainA} = ${updA + drainA}; scan to find ${updB} + ${drainB} = ${updB + drainB}; lazy duplicates ${updC} + ${drainC} = ${updC + drainC} (heap grew to ${peak}, ${stale} stale entries popped)`);
}

console.log("-- a scheduler that serves one task per tick: does a priority-9 task from tick 0 ever run?");
for (const age of [1000000, 100, 50, 10]) {
  // key = priority * age + arrival tick: a larger `age` means priority dominates; no aging is age = 1,000,000
  const h = new Heap();
  h.push((9 * age + 0) * 10000 + 0);
  let served = null;
  for (let t = 1; t <= 2000; t++) {
    const p = ((t * 7 + 3) % 5) + 1; // arrivals are priorities 1 to 5
    h.push((p * age + t) * 10000 + t);
    if (h.pop() % 10000 === 0 && served === null) { served = t; break; }
  }
  const label = served === null ? "never within 2000 ticks" : `served at tick ${served}`;
  console.log(`${age === 1000000 ? "no aging" : `aging: one priority level = ${age} ticks`}: ${label}`);
}
