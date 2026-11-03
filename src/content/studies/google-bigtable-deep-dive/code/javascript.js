// A miniature of the storage engine in the Bigtable paper, in JavaScript (a teaching model, not Google's code): a write goes to a
// commit log and a memtable, a full memtable is flushed to an immutable sorted file (an SSTable), a read looks at the memtable
// and then the files from newest to oldest, a merging compaction keeps the number of files small, and a Bloom filter lets a read
// skip files that cannot hold the row. Everything is deterministic, so every run prints the same thing. All numbers are made up.

const MEMTABLE_LIMIT = 3; // entries that fill a memtable
const MAX_FILES = 2; // a merging compaction runs when there are more files than this
const BLOOM_BITS = 64;

// A tiny Bloom filter: three hashes set three bits. It can say "maybe" wrongly, but never "no" for a row that is there.
function fnv(text, seed) {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (const b of Buffer.from(text)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h;
}
const bitsFor = (row) => [1, 2, 3].map((seed) => fnv(row, seed) % BLOOM_BITS);
const makeFilter = (rows) => { const bits = new Set(); rows.forEach((row) => bitsFor(row).forEach((b) => bits.add(b))); return bits; };
const mightHold = (filter, row) => bitsFor(row).every((b) => filter.has(b));

const log = []; // the commit log: every mutation, in order
let memtable = new Map(); // row -> value, the newest data
let files = []; // SSTables, oldest first: { rows: Map, filter: Set }
let seeks = 0; // file reads, to show what the filter saves
let compactions = 0;

function write(row, value) {
  log.push([row, value]); // the log first, so a crash loses nothing
  memtable.set(row, value);
  if (memtable.size >= MEMTABLE_LIMIT) minorCompaction();
}

function minorCompaction() {
  const rows = new Map([...memtable].sort(([a], [b]) => (a < b ? -1 : 1))); // an SSTable is sorted and never changes
  files.push({ rows, filter: makeFilter(rows.keys()) });
  memtable = new Map();
  if (files.length > MAX_FILES) mergingCompaction();
}

// A merging compaction reads all the files and writes one: the newest value of each row wins.
function mergingCompaction() {
  const merged = new Map();
  for (const file of files) for (const [row, value] of file.rows) merged.set(row, value);
  files = [{ rows: new Map([...merged].sort(([a], [b]) => (a < b ? -1 : 1))), filter: makeFilter(merged.keys()) }];
  compactions++;
}

function read(row, useFilters) {
  if (memtable.has(row)) return memtable.get(row);
  for (const file of [...files].reverse()) {
    if (useFilters && !mightHold(file.filter, row)) continue; // the filter says this file cannot have it
    seeks++;
    if (file.rows.has(row)) return file.rows.get(row);
  }
  return undefined;
}

const rows = ['com.cnn.www', 'com.google.maps', 'org.wikipedia', 'com.example', 'net.apache', 'com.github', 'org.mozilla', 'com.nytimes', 'edu.mit', 'gov.nasa', 'org.python', 'com.apple'];
console.log('--- writes: each one is logged, then buffered, and a full memtable becomes a file');
rows.forEach((row, i) => {
  const filesBefore = files.length;
  write(row, `v${i + 1}`);
  if (files.length !== filesBefore || i + 1 === rows.length) console.log(`after write ${i + 1}: ${files.length} file(s), ${memtable.size} in the memtable, ${log.length} in the log, ${compactions} merging compaction(s)`);
});
write('com.cnn.www', 'v11');
console.log(`rewrote com.cnn.www: the memtable has it now (${read('com.cnn.www', false)}), the file still has the old one`);

console.log('--- reads: looking for rows that exist and rows that do not');
const missing = ['org.nowhere', 'com.absent', 'net.missing', 'edu.gone', 'gov.none'];
seeks = 0; for (const row of missing) read(row, false);
const seeksWithout = seeks;
seeks = 0; for (const row of missing) read(row, true);
const seeksWith = seeks;
console.log(`${missing.length} lookups for missing rows: ${seeksWithout} file reads without Bloom filters, ${seeksWith} with them`);
console.log(`a lookup for com.google.maps returns ${read('com.google.maps', true)}`);
const ok = seeksWith < seeksWithout && read('com.cnn.www', true) === 'v11' && files.length <= MAX_FILES && compactions >= 1;
console.log(`checks ${ok ? 'passed' : 'FAILED'}`);
if (!ok) process.exit(1);
