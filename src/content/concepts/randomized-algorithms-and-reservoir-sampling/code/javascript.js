// Two uses of randomness, with a seeded generator so every run (and every language) prints the same numbers.
// Part 1: quicksort with the first element as pivot against a random pivot, counted in comparisons (one per element tested
//         against the pivot). Look for: sorted input is the worst case for the first-element pivot (n(n-1)/2 comparisons), while
//         a random pivot has no bad input, only bad luck: over 20 seeds on the same sorted input the count stays within a narrow band.
// Part 2: reservoir sampling (Algorithm R): keep k items from a stream of unknown length, using k cells. Look for: every item is
//         kept with the same chance k/n; a plausible-looking shortcut ("replace a random cell half the time") favours late items.
// The generator is the Park-Miller "minimal standard": x = x * 16807 mod 2147483647. The product stays below 2^53, so plain
// 64-bit floats (JavaScript), big integers (Python) and 64-bit integers (C#) all compute it exactly and agree.
const MOD = 2147483647;
function makeRng(seed) {
  let x = seed;
  return (m) => { x = (x * 16807) % MOD; return x % m; }; // an integer in 0 .. m-1 (the tiny modulo bias is ignored here)
}

function shuffled(n, seed) {
  const a = Array.from({ length: n }, (_, i) => i + 1);
  const rand = makeRng(seed);
  for (let i = n - 1; i > 0; i--) { const j = rand(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

// Iterative quicksort (a sorted input would make the recursion n levels deep). Lomuto partition with the pivot moved to the front.
function quicksort(input, pivotRule, seed) {
  const a = input.slice();
  const rand = makeRng(seed);
  let comparisons = 0;
  const stack = [[0, a.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    if (lo >= hi) continue;
    if (pivotRule === 'random') { const p = lo + rand(hi - lo + 1); const t = a[lo]; a[lo] = a[p]; a[p] = t; }
    const pivot = a[lo];
    let i = lo;
    for (let j = lo + 1; j <= hi; j++) {
      comparisons++;
      if (a[j] < pivot) { i++; const t = a[i]; a[i] = a[j]; a[j] = t; }
    }
    const t = a[lo]; a[lo] = a[i]; a[i] = t;
    stack.push([lo, i - 1], [i + 1, hi]);
  }
  for (let i = 1; i < a.length; i++) if (a[i - 1] > a[i]) throw new Error('not sorted');
  return comparisons;
}

const sortedInput = (n) => Array.from({ length: n }, (_, i) => i + 1);
for (const n of [100, 1000, 10000]) {
  console.log(`quicksort, n=${n}`);
  console.log(`  sorted input: first-element pivot ${quicksort(sortedInput(n), 'first', 1)}, random pivot ${quicksort(sortedInput(n), 'random', 1)} (n(n-1)/2 is ${(n * (n - 1)) / 2})`);
  console.log(`  shuffled input: first-element pivot ${quicksort(shuffled(n, 99), 'first', 1)}, random pivot ${quicksort(shuffled(n, 99), 'random', 1)}`);
}
let lowest = Infinity, highest = 0, total = 0;
for (let seed = 1; seed <= 20; seed++) {
  const c = quicksort(sortedInput(1000), 'random', seed);
  lowest = Math.min(lowest, c); highest = Math.max(highest, c); total += c;
}
console.log(`random pivot on sorted input, n=1000, seeds 1 to 20: lowest ${lowest}, highest ${highest}, mean ${Math.floor(total / 20)}`);

// Reservoir sampling. rule 'reservoir': item i (0-based, after the first k) replaces cell j = rand(i+1) when j < k.
// rule 'naive': after the first k, replace a random cell with probability 1/2 (looks fair, is not). rule 'first': keep the first k.
function sample(n, k, rule, rand) {
  const cells = [];
  let writes = 0;
  for (let i = 0; i < n; i++) {
    const item = i + 1;
    if (i < k) { cells.push(item); writes++; continue; }
    if (rule === 'reservoir') { const j = rand(i + 1); if (j < k) { cells[j] = item; writes++; } }
    else if (rule === 'naive') { if (rand(2) === 0) { cells[rand(k)] = item; writes++; } }
  }
  return { cells, writes };
}

const trials = 10000, n = 10, k = 3;
console.log(`how often each of ${n} items is kept in a sample of ${k}, over ${trials} runs (fair is ${(trials * k) / n} each)`);
for (const rule of ['reservoir', 'naive', 'first']) {
  const rand = makeRng(7);
  const counts = new Array(n).fill(0);
  for (let t = 0; t < trials; t++) for (const item of sample(n, k, rule, rand).cells) counts[item - 1]++;
  console.log(`  ${rule}: ${counts.join(' ')}`);
}
for (const size of [1000, 1000000]) {
  const s = sample(size, 5, 'reservoir', makeRng(2024));
  console.log(`one pass over ${size} items, k=5: kept [${s.cells.join(', ')}] after ${s.writes} writes, using 5 cells instead of ${size}`);
}
