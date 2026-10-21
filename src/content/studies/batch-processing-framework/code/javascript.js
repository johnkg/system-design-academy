// A tiny MapReduce job in JavaScript: map tasks with a combiner, a hash-partitioned shuffle,
// reduce tasks, recovery of lost output by re-running only the tasks it came from, and a speculative backup for a straggler.

const SPLITS = 8, REDUCERS = 4, PER_SPLIT = 500, VOCAB = 40;
const TOP_N = 3; // words in the top list
const LOST_REDUCER = 2; // failure demo: the reducer whose output is lost
const BACKUP_NUM = 3; // start a backup copy after 3/2 of the median task time
const BACKUP_DEN = 2;
let seed = 7;
const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 16; };
// Input splits: words with a skew, so a few words are very common.
const splits = Array.from({ length: SPLITS }, () => Array.from({ length: PER_SPLIT }, () => {
  const a = next() % VOCAB, b = next() % VOCAB;
  return 'w' + String(Math.floor((a * b) / VOCAB)).padStart(2, '0');
}));

const fnv = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; };
const runs = { map: 0, reduce: 0 };

// A map task reads one split and writes one bucket per reducer. The combiner adds up equal words before they leave the mapper.
function mapTask(i) {
  runs.map++;
  const buckets = Array.from({ length: REDUCERS }, () => new Map());
  for (const w of splits[i]) { const b = buckets[fnv(w) % REDUCERS]; b.set(w, (b.get(w) ?? 0) + 1); }
  return buckets;
}
// A reduce task fetches its own bucket from every map output and merges them.
function reduceTask(p, mapOut) {
  runs.reduce++;
  const total = new Map();
  for (const out of mapOut) for (const [w, n] of out[p]) total.set(w, (total.get(w) ?? 0) + n);
  return total;
}
const show = (maps) => [...maps].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([w, n]) => `${w}:${n}`).join(',');

let mapOut = splits.map((_, i) => mapTask(i));
let result = Array.from({ length: REDUCERS }, (_, p) => reduceTask(p, mapOut));

const shuffled = mapOut.reduce((s, o) => s + o.reduce((t, b) => t + b.size, 0), 0);
const load = result.map((r) => [...r.values()].reduce((a, b) => a + b, 0));
const merged = new Map(result.flatMap((r) => [...r]));
const top = [...merged].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, TOP_N);
console.log(`input: ${SPLITS} splits x ${PER_SPLIT} words, ${REDUCERS} reducers`);
console.log(`shuffle records: ${SPLITS * PER_SPLIT} without a combiner, ${shuffled} with it`);
console.log(`words per reducer: ${load.join(', ')}; distinct words: ${merged.size}`);
console.log(`top 3: ${top.map(([w, n]) => `${w}=${n}`).join(', ')}`);

// Failure: reducer 2's output is lost, and so are the map outputs held by the machine that ran splits 3 and 5.
const LOST_SPLITS = [3, 5]; // map outputs lost with the failed machine
const before = show(result[LOST_REDUCER]);
runs.map = 0; runs.reduce = 0;
mapOut = mapOut.map((o, i) => (LOST_SPLITS.includes(i) ? mapTask(i) : o)); // recompute the lost inputs from the source splits
result[LOST_REDUCER] = reduceTask(LOST_REDUCER, mapOut);                                    // then only the lost partition
const same = show(result[LOST_REDUCER]) === before;
console.log(`recovery: re-ran ${runs.map} map tasks and ${runs.reduce} reduce task instead of ${SPLITS} and ${REDUCERS}; identical: ${same}`);

// Straggler: nine map tasks run at once, and one machine is slow. After 1.5 x the median time, start a backup copy elsewhere.
const times = [10, 10, 11, 10, 9, 10, 45, 10, 12];
const median = [...times].sort((a, b) => a - b)[times.length >> 1];
const limit = Math.floor((median * BACKUP_NUM) / BACKUP_DEN);
const slowest = Math.max(...times);
const withBackup = Math.max(...times.map((t) => (t > limit ? Math.min(t, limit + median) : t)));
console.log(`straggler: job takes ${slowest} without a backup, ${withBackup} with a backup started at ${limit}`);

const direct = new Map(); for (const s of splits) for (const w of s) direct.set(w, (direct.get(w) ?? 0) + 1);
if (show(direct) !== show(merged) || load.reduce((a, b) => a + b, 0) !== SPLITS * PER_SPLIT || !same || withBackup >= slowest) process.exit(1);
