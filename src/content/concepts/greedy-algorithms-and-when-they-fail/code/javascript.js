// Greedy algorithms: where "take the best-looking choice now" is provably right, and where it quietly is not.
// Operations are counted with an explicit counter (comparisons and candidate checks), not time.
// Four experiments, all deterministic:
//   1. interval scheduling (most non-overlapping jobs): sorting by earliest FINISH is optimal; two other "sensible" rules are not
//   2. weighted interval scheduling: the same earliest-finish rule is now wrong; dynamic programming is right
//   3. coin change: greedy is optimal for 1, 5, 10, 25 and wrong for 1, 3, 4, and for 1, 7, 10; but it is far cheaper
//   4. knapsack: greedy by value per weight is a heuristic with no guarantee, close here but not exact
// Look for: the gap between what a greedy rule picks and the true optimum, and the price of finding the optimum.

const M = 2147483647; // Park-Miller generator, so every language produces the same numbers

class Rng {
  constructor(seed) { this.s = seed; }
  next() { this.s = (this.s * 48271) % M; return this.s; }
}

// Merge sort over job indices by a key, counting every key comparison (stable: equal keys keep their order).
function sortBy(keys, counter) {
  function mergeSort(idx) {
    if (idx.length <= 1) return idx;
    const mid = Math.floor(idx.length / 2);
    const left = mergeSort(idx.slice(0, mid)), right = mergeSort(idx.slice(mid));
    const out = [];
    let i = 0, j = 0;
    while (i < left.length && j < right.length) {
      counter.n++;
      if (keys[left[i]] <= keys[right[j]]) out.push(left[i++]);
      else out.push(right[j++]);
    }
    return out.concat(left.slice(i), right.slice(j));
  }
  return mergeSort(keys.map((_, i) => i));
}

function makeJobs(n) {
  const rng = new Rng(777);
  const jobs = [];
  for (let i = 0; i < n; i++) {
    const s = rng.next() % (4 * n);
    const length = 1 + (rng.next() % 40);
    jobs.push([s, s + length]); // half-open interval [start, end)
  }
  return jobs;
}

const overlap = (a, b) => a[0] < b[1] && b[0] < a[1];

// Greedy: sort by the rule's key, then take every job that does not overlap a job already taken.
// For "finish" and "start" the jobs arrive in time order, so comparing with the last job taken is enough;
// "shortest" arrives in any time order, so each job is compared with every job taken so far.
function schedule(jobs, rule) {
  const keys = jobs.map(([s, e]) => (rule === "finish" ? e : rule === "start" ? s : e - s));
  const counter = { n: 0 };
  const order = sortBy(keys, counter);
  const chosen = [];
  let lastEnd = -1;
  for (const i of order) {
    if (rule === "shortest") {
      let ok = true;
      for (const j of chosen) {
        counter.n++;
        if (overlap(jobs[i], jobs[j])) { ok = false; break; }
      }
      if (ok) chosen.push(i);
    } else {
      counter.n++;
      if (jobs[i][0] >= lastEnd) { chosen.push(i); lastEnd = jobs[i][1]; }
    }
  }
  return [chosen.length, counter.n];
}

function bruteForce(jobs) {
  const n = jobs.length;
  let best = 0;
  for (let mask = 0; mask < (1 << n); mask++) {
    const chosen = [];
    for (let i = 0; i < n; i++) if ((mask >> i) & 1) chosen.push(jobs[i]);
    if (chosen.length <= best) continue;
    chosen.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let ok = true;
    for (let k = 0; k < chosen.length - 1; k++) if (chosen[k][1] > chosen[k + 1][0]) { ok = false; break; }
    if (ok) best = chosen.length;
  }
  return best;
}

console.log("-- interval scheduling: most non-overlapping jobs (jobs chosen, operations)");
for (const n of [10, 100, 1000]) {
  const jobs = makeJobs(n);
  const f = schedule(jobs, "finish"), s = schedule(jobs, "start"), sh = schedule(jobs, "shortest");
  console.log(`  n=${n}: earliest finish ${f[0]} (${f[1]} ops), earliest start ${s[0]} (${s[1]} ops), shortest first ${sh[0]} (${sh[1]} ops)`);
}
const small = makeJobs(14);
console.log(`  brute force over 2^14 = ${1 << 14} subsets of 14 jobs: best ${bruteForce(small)}, earliest finish ${schedule(small, "finish")[0]}, earliest start ${schedule(small, "start")[0]}, shortest first ${schedule(small, "shortest")[0]}`);

// Weighted jobs: maximise total weight. Greedy rules against dynamic programming over jobs sorted by finish time.
function weighted(n) {
  const jobs = makeJobs(n);
  const rng = new Rng(999);
  const w = [];
  for (let i = 0; i < n; i++) w.push(1 + (rng.next() % 20));
  // greedy A: earliest finish, weights ignored
  const counter = { n: 0 };
  const order = sortBy(jobs.map(([s, e]) => e), counter);
  let last = -1, totalA = 0;
  for (const i of order) {
    if (jobs[i][0] >= last) { totalA += w[i]; last = jobs[i][1]; }
  }
  // greedy B: heaviest first, skip any job that overlaps one already taken
  const opsB = { n: 0 };
  const orderB = sortBy(w.map((x) => 1000 - x), opsB);
  const chosen = [];
  let totalB = 0;
  for (const i of orderB) {
    let ok = true;
    for (const j of chosen) {
      opsB.n++;
      if (overlap(jobs[i], jobs[j])) { ok = false; break; }
    }
    if (ok) { chosen.push(i); totalB += w[i]; }
  }
  // dynamic programming: best[k] = best total using the first k jobs in finish order
  const opsDp = { n: counter.n };
  const ends = order.map((i) => jobs[i][1]);
  const best = new Array(n + 1).fill(0);
  for (let k = 1; k <= n; k++) {
    const [s] = jobs[order[k - 1]];
    let lo = 0, hi = k - 1; // how many earlier jobs (in finish order) end at or before this job's start
    while (lo < hi) {
      opsDp.n++;
      const mid = Math.floor((lo + hi) / 2);
      if (ends[mid] <= s) lo = mid + 1; else hi = mid;
    }
    opsDp.n++;
    best[k] = Math.max(best[k - 1], w[order[k - 1]] + best[lo]);
  }
  return [totalA, totalB, best[n], opsB.n, opsDp.n];
}

console.log("-- weighted interval scheduling: total weight (greedy rules against dynamic programming)");
for (const n of [10, 100, 1000]) {
  const [a, b, opt, opsB, opsDp] = weighted(n);
  console.log(`  n=${n}: earliest finish ignoring weights ${a}, heaviest first ${b} (${opsB} ops after sorting), optimal ${opt} (${opsDp} ops)`);
}
console.log("  tiny case: jobs [0,10) weight 10, [0,5) weight 1, [5,10) weight 1: earliest finish takes the two small jobs for weight 2, the optimum is 10");

function greedyCoins(coins, amount) {
  let used = 0, ops = 0;
  for (const c of [...coins].sort((a, b) => b - a)) {
    ops++;
    used += Math.floor(amount / c);
    amount %= c;
  }
  return [amount === 0 ? used : -1, ops];
}

function bestCoins(coins, upto) {
  const table = [0];
  let ops = 0;
  for (let a = 1; a <= upto; a++) {
    let best = 1e9;
    for (const c of coins) {
      ops++;
      if (c <= a && table[a - c] + 1 < best) best = table[a - c] + 1;
    }
    table.push(best);
  }
  return [table, ops];
}

console.log("-- coin change: greedy against the optimum for every amount from 1 to 1000");
for (const coins of [[1, 5, 10, 25], [1, 3, 4], [1, 7, 10], [1, 5, 12], [1, 5, 10, 20, 25]]) {
  const [table] = bestCoins(coins, 1000);
  const bad = [];
  for (let a = 1; a <= 1000; a++) if (greedyCoins(coins, a)[0] !== table[a]) bad.push(a);
  let worst = 0;
  for (const a of bad) worst = Math.max(worst, greedyCoins(coins, a)[0] - table[a]);
  console.log(`  coins {${coins.join(",")}}: greedy wrong for ${bad.length} of 1000 amounts, first at ${bad.length ? bad[0] : "none"}, worst excess ${worst} coins`);
}
console.log("  the price of the optimum: amount 100000 with coins {1,5,10,25}");
const [gUsed, gOps] = greedyCoins([1, 5, 10, 25], 100000);
const [, dpOps] = bestCoins([1, 5, 10, 25], 100000);
console.log(`  greedy ${gUsed} coins in ${gOps} steps, table method ${dpOps} steps`);

// Knapsack, 0/1: items have an integer weight and value; greedy takes items by value per weight while they fit.
function knapsack(n) {
  const items = [];
  for (let i = 0; i < n; i++) items.push([5 + ((i * 7) % 23), 10 + ((i * 11) % 37)]); // [weight, value]
  const cap = Math.floor(items.reduce((s, [w]) => s + w, 0) / 3);
  let ops = 0;
  const order = items.map((_, i) => i);
  // insertion sort by value/weight descending using cross-multiplication (integers only), counted
  for (let i = 1; i < n; i++) {
    let j = i;
    while (j > 0) {
      ops++;
      const a = items[order[j - 1]], b = items[order[j]];
      if (a[1] * b[0] < b[1] * a[0]) {
        [order[j - 1], order[j]] = [order[j], order[j - 1]];
        j--;
      } else break;
    }
  }
  let room = cap, total = 0;
  for (const i of order) {
    ops++;
    if (items[i][0] <= room) { room -= items[i][0]; total += items[i][1]; }
  }
  const best = new Array(cap + 1).fill(0);
  let dpOps = 0;
  for (const [w, v] of items) {
    for (let c = cap; c >= w; c--) {
      dpOps++;
      best[c] = Math.max(best[c], best[c - w] + v);
    }
  }
  return [cap, total, best[cap], ops, dpOps];
}

console.log("-- 0/1 knapsack: greedy by value per weight against the optimum (capacity is a third of the total weight)");
for (const n of [10, 20, 40, 80]) {
  const [cap, g, opt, gOps2, dpOps2] = knapsack(n);
  console.log(`  n=${n}: capacity ${cap}, greedy value ${g}, optimal ${opt}, greedy ${gOps2} ops, table method ${dpOps2} ops`);
}
