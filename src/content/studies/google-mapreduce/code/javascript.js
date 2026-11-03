// A miniature of MapReduce from Google's 2004 paper, in JavaScript (a teaching model, not Google's code):
// a word count with M map tasks and R reduce tasks, a combiner, a partitioning function, a master that re-runs finished map
// tasks when their worker dies (their output was on that worker's local disk), and a backup task for a straggler whose
// duplicate output is ignored. Everything is deterministic.

const SPLITS = ['the quick brown fox', 'the lazy dog', 'the fox and the dog', 'quick quick brown'];
const R = 2;
const WORKERS = ['W1', 'W2', 'W3'];
const local = Object.fromEntries(WORKERS.map((w) => [w, new Map()])); // map output lives on the worker's local disk
const alive = new Set(WORKERS);
const where = new Map(); // map task -> worker that holds its output
const partition = (word) => [...word].reduce((s, ch) => s + ch.charCodeAt(0), 0) % R; // like hash(key) mod R

function runMap(task, worker) {
  const counts = new Map(); // combiner: add up repeated words inside the map task before anything is sent
  for (const word of SPLITS[task].split(' ')) counts.set(word, (counts.get(word) ?? 0) + 1);
  const buckets = Array.from({ length: R }, () => []);
  for (const [word, n] of counts) buckets[partition(word)].push([word, n]);
  local[worker].set(task, buckets);
  where.set(task, worker);
  const pairs = SPLITS[task].split(' ').length, sent = [...counts].length;
  console.log(`map ${task} on ${worker}: ${pairs} pairs became ${sent} after the combiner`);
}

SPLITS.forEach((_, task) => runMap(task, WORKERS[task % WORKERS.length]));

alive.delete('W2');
console.log('W2 stops answering pings and is marked failed');
for (const [task, worker] of [...where]) {
  if (!alive.has(worker)) {
    where.delete(task);
    console.log(`map ${task} was done on ${worker} but its output is on a dead disk: back to idle`);
    runMap(task, 'W3');
    console.log(`map ${task} re-executed on W3`);
  }
}

const outputs = new Map(); // output file name -> worker that finished first
function runReduce(r, worker) {
  const totals = new Map();
  for (let task = 0; task < SPLITS.length; task++) for (const [word, n] of local[where.get(task)].get(task)[r]) totals.set(word, (totals.get(word) ?? 0) + n);
  const line = [...totals].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([w, n]) => `${w}=${n}`).join(' ');
  const file = `part-${r}`;
  if (outputs.has(file)) { console.log(`reduce ${r} also finished on ${worker}, but ${file} already exists from ${outputs.get(file)}: ignored`); return; }
  outputs.set(file, worker);
  console.log(`reduce ${r} finished on ${worker}: ${file} = ${line}`);
}

runReduce(0, 'W1');
console.log('reduce 1 on W3 is a straggler, so the master starts a backup copy on W1');
runReduce(1, 'W1');
runReduce(1, 'W3');
console.log(`output files: ${[...outputs].map(([f, w]) => `${f} (from ${w})`).join(', ')}`);
