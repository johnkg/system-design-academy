// A miniature of one Bigtable tablet from the Bigtable paper (OSDI 2006), in JavaScript (a teaching model, not Google's code):
// every write goes to a commit log and then to an in-memory sorted buffer (the memtable). A full memtable becomes an immutable
// SSTable (a minor compaction). Reads merge the memtable and the SSTables, newest first, and a Bloom filter lets a read skip
// SSTables that cannot hold a row. A crash loses the memtable, which is rebuilt from the log. A major compaction rewrites
// everything into one SSTable and drops deletions. Everything is deterministic.

const MEMTABLE_LIMIT = 3; // entries in the memtable before it is written out
const BLOOM_BITS = 16;
const bloomBits = (row) => { // two cheap hash functions over the row key
  const sum = [...row].reduce((s, ch) => s + ch.charCodeAt(0), 0);
  return [sum % BLOOM_BITS, (sum * 7 + 3) % BLOOM_BITS];
};

const tablet = { log: [], redo: 0, memtable: new Map(), sstables: [], clock: 0 };

function write(row, value) { // value null means a deletion marker
  const entry = { row, value, ts: ++tablet.clock };
  tablet.log.push(entry); // 1. commit log (GFS in the paper)
  tablet.memtable.set(row, entry); // 2. memtable
  if (tablet.memtable.size >= MEMTABLE_LIMIT) minorCompaction();
}

function minorCompaction() {
  const rows = [...tablet.memtable.values()].sort((a, b) => (a.row < b.row ? -1 : 1)); // SSTables are sorted by row key
  const bloom = new Array(BLOOM_BITS).fill(false);
  for (const e of rows) for (const b of bloomBits(e.row)) bloom[b] = true;
  tablet.sstables.unshift({ rows, bloom }); // newest first
  tablet.memtable = new Map();
  tablet.redo = tablet.log.length; // the log before this point is no longer needed for recovery
  console.log(`minor compaction: memtable became SSTable #${tablet.sstables.length} with ${rows.length} entries`);
}

function read(row) {
  if (tablet.memtable.has(row)) { const e = tablet.memtable.get(row); return report(row, e, 0, 0); }
  let touched = 0, skipped = 0;
  for (const table of tablet.sstables) {
    if (!bloomBits(row).every((b) => table.bloom[b])) { skipped++; continue; } // the filter says the row is not here
    touched++;
    const hit = table.rows.find((e) => e.row === row);
    if (hit) return report(row, hit, touched, skipped);
  }
  return report(row, undefined, touched, skipped);
}
function report(row, entry, touched, skipped) {
  const shown = entry === undefined ? 'not found' : entry.value === null ? 'deleted' : entry.value;
  console.log(`read ${row}: ${shown} (read ${touched} SSTable${touched === 1 ? '' : 's'}, Bloom filter skipped ${skipped})`);
}

function crashAndRecover() {
  const lost = tablet.memtable.size;
  tablet.memtable = new Map(); // the memtable lived only in memory
  for (const e of tablet.log.slice(tablet.redo)) tablet.memtable.set(e.row, e); // replay the log from the redo point
  console.log(`crash: lost ${lost} memtable entries, replayed ${tablet.log.length - tablet.redo} from the log, memtable has ${tablet.memtable.size}`);
}

function majorCompaction() {
  const before = tablet.sstables.reduce((n, t) => n + t.rows.length, 0), tables = tablet.sstables.length;
  const newest = new Map();
  for (const table of [...tablet.sstables].reverse()) for (const e of table.rows) newest.set(e.row, e); // newer entries replace older
  const rows = [...newest.values()].filter((e) => e.value !== null).sort((a, b) => (a.row < b.row ? -1 : 1));
  const bloom = new Array(BLOOM_BITS).fill(false);
  for (const e of rows) for (const b of bloomBits(e.row)) bloom[b] = true;
  tablet.sstables = [{ rows, bloom }];
  console.log(`major compaction: ${before} entries in ${tables} SSTables became ${rows.length} entries in 1 SSTable, deletions gone`);
}

// Row keys are reversed host names, so pages of one site sort next to each other.
write('com.cnn.www/index.html', '<html>cnn v1');
write('com.cnn.www/world', '<html>world v1');
write('com.google.maps/index.html', '<html>maps v1');
write('com.cnn.www/index.html', '<html>cnn v2');
write('com.cnn.www/world', null);
write('org.apache.www/index.html', '<html>apache v1');
read('com.cnn.www/index.html');
read('com.cnn.www/world');
read('org.apache.www/index.html');
read('org.example.www/index.html');
write('org.wikipedia.www/index.html', '<html>wiki v1');
crashAndRecover();
read('org.wikipedia.www/index.html');
majorCompaction();
read('com.cnn.www/world');
