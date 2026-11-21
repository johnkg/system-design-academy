// Sorting and searching, counted in comparisons (and steps for counting sort), never in time.
// Look for: insertion sort and first-element quicksort are quadratic on some inputs, merge sort is about n log n on all of
// them, a heap finds the top 10 with far fewer comparisons than a full sort, and sorting only pays for searching after enough searches.
// The "random" input comes from a fixed integer generator, so every language prints the same numbers.

function makeInput(pattern, n) {
  const a = [];
  let x = 12345;
  for (let i = 0; i < n; i++) {
    x = (x * 1664525 + 1013904223) % 4294967296;
    const r = Math.floor(x / 65536) % 100000;
    a.push(pattern === 'sorted' ? i + 1 : pattern === 'reversed' ? n - i : pattern === 'duplicates' ? r % 10 : r);
  }
  return a;
}

// Every sort returns the number of comparisons of two keys. keyOf says what to compare, so records can be sorted by one field.
function insertionSort(a, keyOf = (v) => v) {
  let count = 0;
  for (let i = 1; i < a.length; i++) {
    const v = a[i];
    let j = i;
    while (j > 0) {
      count++;
      if (keyOf(a[j - 1]) > keyOf(v)) { a[j] = a[j - 1]; j--; } else break;
    }
    a[j] = v;
  }
  return count;
}

function mergeSort(a, keyOf = (v) => v) {
  let count = 0;
  const sort = (lo, hi) => { // sorts a[lo..hi)
    if (hi - lo < 2) return;
    const mid = Math.floor((lo + hi) / 2);
    sort(lo, mid); sort(mid, hi);
    const left = a.slice(lo, mid), right = a.slice(mid, hi);
    let i = 0, j = 0, k = lo;
    while (i < left.length && j < right.length) {
      count++;
      if (keyOf(right[j]) < keyOf(left[i])) a[k++] = right[j++]; else a[k++] = left[i++]; // ties take the left one: stable
    }
    while (i < left.length) a[k++] = left[i++];
    while (j < right.length) a[k++] = right[j++];
  };
  sort(0, a.length);
  return count;
}

// Quicksort with the FIRST element as pivot (a naive choice), Lomuto partition, explicit stack so deep recursion cannot overflow.
function quickSort(a, keyOf = (v) => v) {
  let count = 0;
  const stack = [[0, a.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    if (lo >= hi) continue;
    const pivot = keyOf(a[lo]);
    let i = lo;
    for (let j = lo + 1; j <= hi; j++) {
      count++;
      if (keyOf(a[j]) < pivot) { i++; [a[i], a[j]] = [a[j], a[i]]; }
    }
    [a[lo], a[i]] = [a[i], a[lo]];
    stack.push([lo, i - 1], [i + 1, hi]);
  }
  return count;
}

// Counting sort: no comparisons at all. Steps = n to count, (largest key + 1) to scan the counts, n to write out.
function countingSort(a) {
  let max = 0;
  for (const v of a) max = Math.max(max, v);
  const counts = new Array(max + 1).fill(0);
  let steps = 0;
  for (const v of a) { counts[v]++; steps++; }
  const out = [];
  for (let v = 0; v <= max; v++) { steps++; for (let c = 0; c < counts[v]; c++) { out.push(v); steps++; } }
  return steps;
}

// Top k with a min-heap of size k: n log k instead of n log n. Counts comparisons, sift-up and sift-down included.
function topK(a, k) {
  let count = 0;
  const h = [];
  const siftUp = (i) => { while (i > 0) { const p = (i - 1) >> 1; count++; if (h[i] < h[p]) { [h[i], h[p]] = [h[p], h[i]]; i = p; } else break; } };
  const siftDown = (i) => {
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      if (l >= h.length) break;
      let s = l;
      if (r < h.length) { count++; if (h[r] < h[l]) s = r; }
      count++;
      if (h[s] < h[i]) { [h[i], h[s]] = [h[s], h[i]]; i = s; } else break;
    }
  };
  for (const x of a) {
    if (h.length < k) { h.push(x); siftUp(h.length - 1); } else { count++; if (x > h[0]) { h[0] = x; siftDown(0); } }
  }
  return { count, top: [...h].sort((p, q) => q - p) };
}

const pad = (v) => String(v);
console.log('-- comparisons to sort n items (counting sort: steps)');
for (const n of [10, 100, 1000]) {
  for (const pattern of ['random', 'sorted', 'reversed', 'duplicates']) {
    const base = makeInput(pattern, n);
    const ins = insertionSort([...base]), mer = mergeSort([...base]), qs = quickSort([...base]), cs = countingSort(base);
    console.log(`n=${n} ${pattern}: insertion ${ins}, merge ${mer}, quicksort(first pivot) ${qs}, counting steps ${cs}, top-10 heap ${topK(base, 10).count}`);
  }
}

// The sorts really sort, and the heap really finds the 10 largest.
{
  const a = makeInput('random', 1000);
  const sorted = [...a]; mergeSort(sorted);
  for (const f of [insertionSort, quickSort]) { const b = [...a]; f(b); if (b.join() !== sorted.join()) throw new Error('not sorted'); }
  const expected = sorted.slice(-10).reverse();
  console.log(`-- heap top 10 equals the last 10 of the full sort: ${topK(a, 10).top.join() === expected.join()}`);
}

// Binary search: one comparison per probe. Linear search: one per element looked at. Both look for the LAST element.
function binarySearch(a, target) {
  let lo = 0, hi = a.length - 1, count = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    count++;
    if (a[mid] === target) return count;
    if (a[mid] < target) lo = mid + 1; else hi = mid - 1;
  }
  return count;
}
// The classic bug: "lo = mid" instead of "lo = mid + 1" never makes progress when lo and mid meet. Capped at 50 probes here.
function buggyBinarySearch(a, target) {
  let lo = 0, hi = a.length - 1, count = 0;
  while (lo < hi && count < 50) {
    const mid = Math.floor((lo + hi) / 2);
    count++;
    if (a[mid] < target) lo = mid; else hi = mid;
  }
  return count;
}
console.log('-- searching for the last item of a sorted list');
for (const n of [10, 1000, 1000000]) {
  const a = makeInput('sorted', n);
  let linear = 0;
  for (let i = 0; i < n; i++) { linear++; if (a[i] === n) break; }
  console.log(`n=${n}: linear ${linear} comparisons, binary ${binarySearch(a, n)}`);
}
console.log(`buggy binary search (lo = mid) on 10 items: ${buggyBinarySearch(makeInput('sorted', 10), 10)} probes, then gave up at the cap of 50`);

// Sorting once to search many times: sort cost against the saving of binary over linear search (average linear cost about n/2).
console.log('-- searches needed before sorting first pays off');
for (const n of [100, 1000, 10000]) {
  const sortCost = mergeSort(makeInput('random', n));
  const linear = Math.ceil(n / 2), binary = Math.floor(Math.log2(n)) + 1;
  let q = 1;
  while (sortCost + q * binary >= q * linear) q++;
  console.log(`n=${n}: sort ${sortCost}, linear ${linear} per search, binary ${binary} per search, break-even at ${q} searches`);
}

// Traps: sorting to find the minimum, sorting inside a loop, a key recomputed in every comparison.
console.log('-- traps');
{
  const n = 1000, a = makeInput('random', n);
  console.log(`minimum of ${n}: a scan needs ${n - 1} comparisons, sorting first needs ${mergeSort([...a])}`);
  const sortCost = mergeSort([...a]);
  console.log(`100 lookups that each re-sort ${n} items: ${100 * sortCost} comparisons; sorting once: ${sortCost}`);
  console.log(`sort ${n} items by a computed key: ${2 * sortCost} key computations if the comparator recomputes both keys, ${n} if keys are computed once first`);
}

// Stability: records are key*1000 + id. Equal keys should keep their original order (ids ascending).
console.log('-- stability: ids of the records after sorting by key');
{
  const records = [2001, 1002, 2003, 1004, 2005, 1006, 2007, 1008];
  const key = (v) => Math.floor(v / 1000);
  const ids = (a) => a.map((v) => v % 1000).join(' ');
  const i = [...records]; insertionSort(i, key);
  const m = [...records]; mergeSort(m, key);
  const q = [...records]; quickSort(q, key);
  console.log(`insertion (stable): ${ids(i)}`);
  console.log(`merge (stable): ${ids(m)}`);
  console.log(`quicksort (not stable): ${ids(q)}`);
}
