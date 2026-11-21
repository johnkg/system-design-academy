// Big O: count operations (one comparison or one element visit each), never time, for five algorithms at growing n.
// Look for: the counts grow at different rates. Doubling n makes the n^2 check cost 4x, while binary search barely moves.
let ops = 0;

function linearSearch(a, target) { // worst case: the target is not there, so every element is visited
  ops = 0;
  for (const x of a) { ops++; if (x === target) break; }
  return ops;
}

function binarySearch(a, target) { // one comparison per halving of the range
  ops = 0;
  let lo = 0, hi = a.length - 1;
  while (lo <= hi) {
    ops++;
    const mid = Math.floor((lo + hi) / 2);
    if (a[mid] === target) break;
    if (a[mid] < target) lo = mid + 1; else hi = mid - 1;
  }
  return ops;
}

function hasDuplicateNested(a) { // compares every pair once; no duplicates here, so it never stops early
  ops = 0;
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) { ops++; if (a[i] === a[j]) return ops; }
  return ops;
}

function mergeSort(a) { // counts the comparisons made while merging
  if (a.length <= 1) return a;
  const mid = Math.floor(a.length / 2);
  const left = mergeSort(a.slice(0, mid)), right = mergeSort(a.slice(mid));
  const out = [];
  let i = 0, j = 0;
  while (i < left.length && j < right.length) { ops++; out.push(left[i] <= right[j] ? left[i++] : right[j++]); }
  while (i < left.length) out.push(left[i++]);
  while (j < right.length) out.push(right[j++]);
  return out;
}

function countSubsets(n) { // visits every subset of n items: 2^n of them
  ops = 0;
  for (let mask = 0; mask < 2 ** n; mask++) ops++;
  return ops;
}

for (const n of [10, 100, 1000]) {
  const data = Array.from({ length: n }, (_, i) => (i * 7919) % n); // a fixed shuffle of 0..n-1, no duplicates
  const sorted = Array.from({ length: n }, (_, i) => i);
  const linear = linearSearch(data, -1);
  const binary = binarySearch(sorted, n); // absent and larger than everything: worst case
  const nested = hasDuplicateNested(data);
  ops = 0; mergeSort(data); const sort = ops;
  console.log(`n=${n}: linear search ${linear}, binary search ${binary}, nested duplicate check ${nested}, merge sort ${sort}`);
}
for (const n of [10, 15, 20]) console.log(`subsets of ${n} items: ${countSubsets(n)} visited`);

// A constant factor: an O(n) algorithm that does 100 steps per item against a plain O(n^2) one.
let n = 1;
while (!(100 * n < n * n)) n++;
console.log(`100n beats n^2 only from n = ${n}`);
