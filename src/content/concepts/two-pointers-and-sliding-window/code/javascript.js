// Two pointers and a sliding window, counted in steps (one pair checked, or one element added to or removed from a window).
// Look for: on a sorted list, two pointers find a pair in at most n - 1 checks where trying every pair needs n(n-1)/2;
// on positive numbers, a window finds the longest stretch with sum <= K in at most 2n steps; with negative numbers the
// same window code is fast but WRONG, and the only simple fix is back to the O(n^2) loops.
// Data comes from fixed integer formulas, so every language prints the same numbers.

// strictly increasing: the steps between neighbours are 1 to 5
function sortedList(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push(3 * i + ((i * 7 + 1) % 3));
  return a;
}

function pairBrute(a, target) {
  let steps = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      steps++;
      if (a[i] + a[j] === target) return [steps, true];
    }
  }
  return [steps, false];
}

function pairTwoPointers(a, target) {
  let lo = 0, hi = a.length - 1, steps = 0;
  while (lo < hi) {
    steps++;
    const s = a[lo] + a[hi];
    if (s === target) return [steps, true];
    if (s < target) lo++; // the pair (lo, anything left of hi) is too small
    else hi--; // the pair (anything right of lo, hi) is too big
  }
  return [steps, false];
}

// positive: 1..9. mixed: -3..5, so some elements pull the sum back down.
function values(n, mode) {
  const v = [];
  for (let i = 0; i < n; i++) v.push(((i * 7 + 3) % 9) + (mode === "positive" ? 1 : -3));
  return v;
}

// Longest stretch with sum <= k. With positive numbers a sum can only grow, so each start stops at the first sum > k.
// With negative numbers a later element can bring the sum back down, so each start must look at every end.
function windowBrute(v, k, mode) {
  let best = 0, steps = 0;
  for (let l = 0; l < v.length; l++) {
    let s = 0;
    for (let r = l; r < v.length; r++) {
      s += v[r];
      steps++;
      if (s <= k) best = Math.max(best, r - l + 1);
      else if (mode === "positive") break;
    }
  }
  return [steps, best];
}

// The usual window: grow on the right, shrink from the left while the sum is too big.
function windowSliding(v, k) {
  let best = 0, steps = 0, l = 0, s = 0;
  for (let r = 0; r < v.length; r++) {
    s += v[r];
    steps++;
    while (s > k && l <= r) {
      s -= v[l];
      l++;
      steps++;
    }
    best = Math.max(best, r - l + 1);
  }
  return [steps, best];
}

console.log("-- a pair that adds up to a target in a sorted list: every pair against two pointers");
for (const n of [10, 100, 1000, 10000]) {
  const a = sortedList(n);
  for (const [name, target] of [["no pair exists", 1], ["a pair exists", a[Math.floor(n / 4)] + a[Math.floor((3 * n) / 4)]]]) {
    const [bs, bf] = pairBrute(a, target);
    const [ts, tf] = pairTwoPointers(a, target);
    console.log(`n=${n} ${name}: every pair ${bs} checks (found ${bf}), two pointers ${ts} checks (found ${tf})`);
  }
}

console.log("-- longest stretch with sum <= K: try every start against a sliding window");
for (const mode of ["positive", "mixed"]) {
  for (const n of [10, 100, 1000, 10000]) {
    const v = values(n, mode);
    for (const k of [50, 500]) {
      const [bs, bb] = windowBrute(v, k, mode);
      const [ws, wb] = windowSliding(v, k);
      const verdict = bb === wb ? "same answer" : `WRONG: window says ${wb}, the true answer is ${bb}`;
      console.log(`${mode} n=${n} K=${k}: try every start ${bs} steps, window ${ws} steps, ${verdict}`);
    }
  }
}
