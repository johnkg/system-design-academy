// Space-time tradeoff: answer many range-sum queries over an array of n numbers in three ways, counting steps and memory cells.
//   recompute:   no extra memory, but every query adds up its whole range again.
//   prefix sums: one pass builds n + 1 running totals (n + 1 cells); every query is one subtraction.
//   full table:  the sum of every range stored in an n x n table (n * n cells); every query is one lookup.
// Each query asks for a range of half the array (n / 2 elements). Look for: the table's memory is quadratic, and a precomputation
// only pays off after enough queries (the break-even), and never against the prefix table here.
const BYTES_PER_CELL = 8; // typically 8 bytes for a 64-bit number in a compact array; boxed objects cost more

function costs(technique, n) {
  const half = Math.floor(n / 2);
  if (technique === 'recompute') return { build: 0, perQuery: half, cells: 0 };
  if (technique === 'prefix') return { build: n, perQuery: 1, cells: n + 1 };
  return { build: n * n, perQuery: 1, cells: n * n };
}
const total = (t, n, q) => { const c = costs(t, n); return c.build + q * c.perQuery; };
// Smallest number of queries at which the technique's total is below recomputing every time (0 = never).
function breakEven(t, n) {
  const c = costs(t, n), r = costs('recompute', n);
  if (c.perQuery >= r.perQuery) return 0;
  let q = Math.floor(c.build / (r.perQuery - c.perQuery)) + 1;
  while (total(t, n, q) >= total('recompute', n, q)) q++;
  return q;
}

console.log('-- cost model: build steps, steps per query, memory cells');
for (const n of [100, 1000, 10000, 100000]) {
  for (const t of ['recompute', 'prefix', 'table']) {
    const c = costs(t, n);
    console.log(`n=${n} ${t}: build ${c.build}, per query ${c.perQuery}, memory ${c.cells} cells`);
  }
}
console.log('-- total steps for q queries');
for (const [n, q] of [[1000, 10], [1000, 1000], [1000, 100000], [100000, 1000]]) {
  console.log(`n=${n} q=${q}: recompute ${total('recompute', n, q)}, prefix ${total('prefix', n, q)}, table ${total('table', n, q)}`);
}
console.log('-- queries needed before the precomputation beats recomputing');
for (const n of [100, 1000, 10000]) console.log(`n=${n}: prefix ${breakEven('prefix', n)}, table ${breakEven('table', n)}`);
console.log(`a table of 100000 x 100000 cells at ${BYTES_PER_CELL} bytes each: ${Math.floor((100000 * 100000 * BYTES_PER_CELL) / 1000000000)} GB`);

// The model is checked against real code at a small size: the three methods give the same answers, and the counters match.
{
  const n = 50, a = Array.from({ length: n }, (_, i) => (i * 7) % 13);
  const queries = [];
  let x = 99;
  for (let i = 0; i < 20; i++) { x = (x * 1103515245 + 12345) % 2147483648; queries.push(x % (n - n / 2 + 1)); } // start of a range of n/2 elements
  let stepsR = 0, answersR = 0;
  for (const s of queries) { for (let i = s; i < s + n / 2; i++) { answersR += a[i]; stepsR++; } }
  const prefix = [0]; let stepsP = 0;
  for (let i = 0; i < n; i++) { prefix.push(prefix[i] + a[i]); stepsP++; }
  let answersP = 0; for (const s of queries) { answersP += prefix[s + n / 2] - prefix[s]; stepsP++; }
  const table = Array.from({ length: n }, () => new Array(n).fill(0)); let stepsT = 0;
  for (let i = 0; i < n; i++) { let run = 0; for (let j = 0; j < n; j++) { if (j >= i) run += a[j]; table[i][j] = run; stepsT++; } }
  let answersT = 0; for (const s of queries) { answersT += table[s][s + n / 2 - 1]; stepsT++; }
  console.log(`-- model against real code (n=${n}, 20 queries): same answers ${answersR === answersP && answersP === answersT}`);
  console.log(`steps counted: recompute ${stepsR} (model ${total('recompute', n, 20)}), prefix ${stepsP} (model ${total('prefix', n, 20)}), table ${stepsT} (model ${total('table', n, 20)})`);
}

// A cache with no eviction grows with the number of distinct keys; a cache with a cap stays bounded but gives up some hits.
{
  const requests = 100000, keys = 50000, cap = 1000;
  let x = 12345, hitsU = 0, hitsC = 0;
  const unbounded = new Set(), capped = new Set(), order = [];
  for (let i = 0; i < requests; i++) {
    x = (x * 1664525 + 1013904223) % 4294967296;
    const k = Math.floor(x / 65536) % keys;
    if (unbounded.has(k)) hitsU++; else unbounded.add(k);
    if (capped.has(k)) hitsC++; else { capped.add(k); order.push(k); if (order.length > cap) capped.delete(order.shift()); } // first in, first out
  }
  console.log(`-- cache over ${requests} requests for ${keys} possible keys`);
  console.log(`no eviction: ${unbounded.size} entries, ${hitsU} hits`);
  console.log(`capped at ${cap} entries (first in, first out): ${capped.size} entries, ${hitsC} hits`);
}
