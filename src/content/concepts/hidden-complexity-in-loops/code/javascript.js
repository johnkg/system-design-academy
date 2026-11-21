// Hidden complexity in loops: four jobs that look like one loop, each done the naive way and the fixed way.
// Steps are counted by an explicit model, not timed. A step is one comparison, one element moved or one character copied.
// Where a language's own library would hide the cost (`x in list`, `s += piece`, `list.pop(0)`), the loop below is written out
// by hand so the counter sees what the runtime does underneath (real runtimes may optimise some of these cases).
const PIECE = 4; // characters in one piece of the string being built

function findDuplicatesNaive(ids) { // `if x in seen_list` scans the list on every item
  let steps = 0; const seen = [];
  for (const x of ids) {
    for (const s of seen) { steps++; if (s === x) break; }
    seen.push(x); steps++;
  }
  return steps;
}
function findDuplicatesFixed(ids) { // a hash set: one lookup and one insert per item (average case, 1 step each)
  let steps = 0; const seen = new Set();
  for (const x of ids) { steps++; seen.has(x); steps++; seen.add(x); }
  return steps;
}
function buildStringNaive(n) { // s = s + piece copies the whole growing string each time (in many languages, typically)
  let steps = 0, length = 0;
  for (let i = 0; i < n; i++) { steps += length + PIECE; length += PIECE; }
  return steps;
}
function buildStringFixed(n) { // collect the pieces, then join once: every character is copied one time
  let steps = 0; const parts = [];
  for (let i = 0; i < n; i++) { parts.push(i); steps++; }
  return steps + n * PIECE;
}
function drainFromFrontNaive(n) { // remove(0) on an array shifts every later element one place left
  let steps = 0; const a = Array.from({ length: n }, (_, i) => i);
  while (a.length > 0) {
    for (let i = 1; i < a.length; i++) { a[i - 1] = a[i]; steps++; }
    a.pop(); steps++;
  }
  return steps;
}
function drainFromFrontFixed(n) { // a queue (deque, linked list or ring buffer) takes from the front in one step
  let steps = 0, head = 0; const a = Array.from({ length: n }, (_, i) => i);
  while (head < a.length) { head++; steps++; }
  return steps;
}
function lookupPerRowNaive(n) { // for each row, scan the table for its key (rows come in table order)
  let steps = 0; const table = Array.from({ length: n }, (_, i) => i);
  for (let row = 0; row < n; row++) for (const key of table) { steps++; if (key === row) break; }
  return steps;
}
function lookupPerRowFixed(n) { // build a dictionary once, then one lookup per row
  let steps = 0; const dict = new Map();
  for (let i = 0; i < n; i++) { dict.set(i, i); steps++; }
  for (let row = 0; row < n; row++) { dict.get(row); steps++; }
  return steps;
}

const tasks = [
  ['find duplicates', (n) => { const ids = Array.from({ length: n }, (_, i) => i * 3 + 1); return [findDuplicatesNaive(ids), findDuplicatesFixed(ids)]; }, (n) => (n * (n - 1)) / 2 + n],
  ['build a string', (n) => [buildStringNaive(n), buildStringFixed(n)], (n) => (PIECE * n * (n + 1)) / 2],
  ['drain from front', (n) => [drainFromFrontNaive(n), drainFromFrontFixed(n)], (n) => (n * (n + 1)) / 2],
  ['lookup per row', (n) => [lookupPerRowNaive(n), lookupPerRowFixed(n)], (n) => (n * (n + 1)) / 2],
];
for (const n of [10, 100, 1000]) {
  console.log(`n=${n}`);
  for (const [name, run, formula] of tasks) {
    const [naive, fixed] = run(n);
    if (naive !== formula(n)) throw new Error(`model mismatch for ${name}`);
    console.log(`  ${name}: naive ${naive} steps, fixed ${fixed} steps, ${Math.floor(naive / fixed)}x`);
  }
}
for (const [name, , formula] of tasks) {
  let n = 1;
  while (formula(n) < 1000000000) n++;
  console.log(`${name}: the naive version passes 1000000000 steps at n = ${n}`);
}
