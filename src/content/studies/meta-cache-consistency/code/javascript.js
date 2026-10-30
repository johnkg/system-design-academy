// Three ideas from Meta's cache consistency posts, as a small model in JavaScript (not Meta's code or data):
// 1. A fill that races an invalidation: a version check ignores older data, but only while the cache still remembers the version.
// 2. An error handler that drops an item only if its version is lower, which does nothing for a stale item that already has the latest version.
// 3. A Polaris-style checker: it re-checks a mismatch and only reports it, and only then asks the database, once it has lasted a whole timescale.
// Time is simulated (seconds), so every run prints the same thing.

// Part 1: the cache holds entries { value, version }. `mode` decides how a new value is accepted.
//   none: always overwrite. version: ignore older data while an entry exists. remember: also keep the version of evicted entries.
function newCache(mode) {
  return { mode, entries: new Map(), remembered: new Map() };
}
function accept(cache, key, value, version) {
  const entry = cache.entries.get(key);
  let newest = entry ? entry.version : 0;
  if (cache.mode === 'remember') newest = Math.max(newest, cache.remembered.get(key) ?? 0);
  if (cache.mode !== 'none' && newest >= version) return; // older data never overwrites newer data
  cache.entries.set(key, { value, version });
}
function evict(cache, key) {
  const entry = cache.entries.get(key);
  if (entry && cache.mode === 'remember') cache.remembered.set(key, entry.version);
  cache.entries.delete(key);
}

console.log('The database holds x=43 at version 2. A fill read x=42 at version 1 earlier, and its reply is late.');
for (const evicted of [false, true]) {
  for (const mode of ['none', 'version', 'remember']) {
    const cache = newCache(mode);
    accept(cache, 'x', 43, 2); // the invalidation arrives first
    if (evicted) evict(cache, 'x'); // the entry is evicted before the late reply
    accept(cache, 'x', 42, 1); // the old fill reply arrives last
    const entry = cache.entries.get('x');
    const result = !entry ? 'no entry, the next read refills it from the database (consistent)' : entry.value === 43 ? 'cache x=43 (consistent)' : 'cache x=42 (stale)';
    console.log(`  ${evicted ? 'evicted' : 'kept   '}, ${mode.padEnd(8)} -> ${result}`);
  }
}

// Part 2: the cache holds metadata 0 at version 4 but the database holds metadata 1 at version 4.
function dropIfLower(entries, key, version) {
  const entry = entries.get(key);
  if (entry && entry.version < version) entries.delete(key);
}
function handleInvalidation(entries, error, handler) {
  if (!error) entries.set('meta', { value: 1, version: 4 }); // the normal path writes the new data
  else if (handler === 'drop if lower') dropIfLower(entries, 'meta', 4);
  else entries.delete('meta'); // drop whatever the version
}
console.log('The cache holds metadata=0 at version 4. The database holds metadata=1 at version 4.');
for (const [error, handler] of [[false, '-'], [true, 'drop if lower'], [true, 'drop always']]) {
  const entries = new Map([['meta', { value: 0, version: 4 }]]);
  handleInvalidation(entries, error, handler);
  const entry = entries.get('meta');
  const result = !entry ? 'dropped, the next read refills it from the database' : entry.value === 1 ? 'consistent' : 'stale for good';
  console.log(`  ${error ? 'error' : 'no error'}, handler ${handler.padEnd(13)} -> ${result}`);
}

// Part 3: an invalidation says x is 4 at version 4. Three replicas are checked at second 0.
const TIMESCALES = [60, 300]; // report after one minute and after five minutes
function replicaHolds(name, second) {
  if (name === 'a') return 4; // up to date
  if (name === 'b') return second >= 40 ? 4 : 3; // catches up at second 40
  return 3; // c stays stale
}
let withDelay = 0, immediate = 0;
console.log('An invalidation says x=4 at version 4. Replicas are checked at second 0, then again at each timescale.');
for (const name of ['a', 'b', 'c']) {
  if (replicaHolds(name, 0) === 4) { console.log(`  replica ${name}: consistent at second 0`); continue; }
  immediate++; // checking the database at once would cost one query for every mismatch
  const reported = TIMESCALES.filter((t) => replicaHolds(name, t) !== 4);
  if (reported.length) withDelay++; // one database check, made when the sample crosses its first timescale
  const text = reported.length ? `still wrong after ${reported.map((t) => `${t / 60} min`).join(' and ')}, reported` : 'fixed itself by second 60, never reported';
  console.log(`  replica ${name}: wrong at second 0, ${text}`);
}
console.log(`database checks that bypass the cache: ${withDelay} with the delay, ${immediate} if made at once`);

if (withDelay >= immediate) process.exit(1);
