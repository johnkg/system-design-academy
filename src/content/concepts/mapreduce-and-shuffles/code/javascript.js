// A miniature MapReduce: map, optional combiner, hash-partitioned shuffle, sort, reduce. Then a hot-key skew demo with salting.

const fnv1a = (s) => { // 32-bit FNV-1a: stable across languages, unlike built-in hash codes
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};

function mapPhase(split, useCombiner) {
  const out = split.flatMap((line) => line.split(" ").map((w) => [w, 1])); // map: emit (word, 1)
  if (!useCombiner) return out;
  const local = new Map(); // combiner: pre-sum inside the mapper, before anything crosses the network
  for (const [w, n] of out) local.set(w, (local.get(w) ?? 0) + n);
  return [...local.entries()];
}

function shuffle(mapOutputs, reducers) {
  const buckets = Array.from({ length: reducers }, () => []);
  for (const records of mapOutputs) for (const [k, v] of records) buckets[fnv1a(k) % reducers].push([k, v]);
  return buckets;
}

function reducePhase(bucket) {
  const sorted = [...bucket].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); // reducers see keys in sorted order
  const result = new Map();
  for (const [k, v] of sorted) result.set(k, (result.get(k) ?? 0) + v);
  return result;
}

const splits = [
  ["the cat sat on the mat", "the dog sat on the log"],
  ["the cat saw the dog", "the dog saw the cat"],
  ["a cat and a dog sat", "on the mat and the log"],
];
const R = 3;
const totals = {};
for (const combiner of [false, true]) {
  const outputs = splits.map((s) => mapPhase(s, combiner));
  const buckets = shuffle(outputs, R);
  const merged = new Map();
  for (const b of buckets) for (const [k, v] of reducePhase(b)) merged.set(k, v);
  const shuffled = buckets.reduce((n, b) => n + b.length, 0);
  console.log(`combiner=${combiner}: shuffled ${shuffled} records, per reducer [${buckets.map((b) => b.length).join(", ")}]`);
  totals[combiner] = [...merged.entries()].sort().map(([k, v]) => `${k}=${v}`).join(" ");
}
console.log(totals[true]);
if (totals[true] !== totals[false]) throw new Error("combiner changed the answer");

// Skew: 2000 events, half of them for one hot key. One reducer gets the hot key and becomes the straggler.
const EVENTS = 2000, COLD_USERS = 50, SEED = 12345;
const SALT_BUCKETS = R * 2; // the hot key is split over this many salted keys
let seed = SEED;
// Linear congruential generator (Numerical Recipes constants).
const rand = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 8) % n; };
const events = Array.from({ length: EVENTS }, (_, i) => (i % 2 === 0 ? "hot" : "user" + rand(COLD_USERS)));
const ratio = (l) => { const h = Math.floor((Math.max(...l) * R * 100) / EVENTS); return `${Math.floor(h / 100)}.${String(h % 100).padStart(2, "0")}`; };
const load = (keyOf) => {
  const l = new Array(R).fill(0);
  for (const e of events) l[fnv1a(keyOf(e)) % R]++;
  return l;
};
const plain = load((e) => e);
const salted = load((e) => (e === "hot" ? "hot#" + rand(SALT_BUCKETS) : e)); // stage 1: spread the hot key over 6 salted keys
console.log(`plain  load [${plain.join(", ")}] slowest/average = ${ratio(plain)}`);
console.log(`salted load [${salted.join(", ")}] slowest/average = ${ratio(salted)}`);
console.log("stage 2 merges the 6 partial counts of 'hot' into one number (tiny shuffle)");
if (plain.reduce((a, b) => a + b) !== EVENTS || salted.reduce((a, b) => a + b) !== EVENTS) throw new Error("records lost");
