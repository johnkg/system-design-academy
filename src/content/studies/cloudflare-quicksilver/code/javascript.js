// A miniature of three ideas from Cloudflare's Quicksilver posts, in JavaScript (a teaching model, not Cloudflare's code):
// 1. a numbered log, so a replica can notice a missing entry and ask again from the last entry it applied,
// 2. a replica that keeps older versions of a key, so it can answer "what was the value as of log index N?",
// 3. a proxy that keeps a small window of the newest updates, so it never has to ask a replica that is behind it.
// Everything is deterministic, so every run prints the same thing.

// The log written at the top of the tree: [index, operation, key, value]. Indexes go up by exactly one.
const LOG = [
  [1, 'SET', 'a', 1], [2, 'SET', 'b', 1], [3, 'SET', 'a', 2], [4, 'SET', 'c', 1],
  [5, 'DEL', 'b', null], [6, 'SET', 'd', 1], [7, 'SET', 'b', 2], [8, 'SET', 'e', 1],
];
const WINDOW = 3; // how many of the newest updates a proxy keeps

class Replica {
  constructor(dbId) {
    this.dbId = dbId;
    this.last = 0; // index of the last entry applied
    this.current = new Map(); // key -> [index written, value]; a value of null is a tombstone (the key was deleted)
    this.history = new Map(); // key -> older [index, value] versions, oldest first
  }

  apply([index, op, key, value]) {
    if (index !== this.last + 1) return false; // a gap (or a repeat): refuse it
    if (this.current.has(key)) {
      if (!this.history.has(key)) this.history.set(key, []);
      this.history.get(key).push(this.current.get(key));
    }
    this.current.set(key, [index, op === 'SET' ? value : null]);
    this.last = index;
    return true;
  }

  // The value of a key as it was when the log was at `index`.
  getAt(key, index) {
    if (this.current.has(key) && this.current.get(key)[0] <= index) return this.current.get(key)[1];
    const older = this.history.get(key) ?? [];
    for (let i = older.length - 1; i >= 0; i--) if (older[i][0] <= index) return older[i][1];
    return null; // the key did not exist yet at that index
  }
}

const handshake = (clientDb, serverDb) => clientDb === serverDb;
const show = (value) => (value === null ? 'not found' : String(value));

// 1. Replication with a numbered log.
const replica = new Replica('dns');
for (const entry of [LOG[0], LOG[1], LOG[2], LOG[4]]) { // entry 4 is lost on the way
  if (!replica.apply(entry)) {
    console.log(`replica at index ${replica.last}: got entry ${entry[0]} but expected ${replica.last + 1}, asks again from index ${replica.last}`);
    break;
  }
}
for (const entry of LOG.slice(replica.last)) replica.apply(entry);
console.log(`replica resynced and is now at index ${replica.last}`);
console.log(`handshake with database page-rules: ${handshake('dns', 'page-rules') ? 'accepted' : 'refused'}`);
console.log(`handshake with database dns: ${handshake('dns', 'dns') ? 'accepted' : 'refused'}`);

// 2. A proxy at index 5 asks a replica at index 8, which keeps older versions.
const behind = new Replica('dns'); // what a replica that had stopped at index 5 would answer
for (const entry of LOG.slice(0, 5)) behind.apply(entry);
let ok = true;
for (const key of 'abcde') {
  const answer = replica.getAt(key, 5);
  ok = ok && answer === behind.getAt(key, 5);
  console.log(`read ${key} as of index 5: ${show(answer)} (the replica is at index ${replica.last})`);
}

// 3. A proxy at index 8 asks a replica that is still at index 5.
const proxyWindow = new Map(); // key -> [index, value] for the newest WINDOW updates
for (const [index, op, key, value] of LOG.slice(-WINDOW)) proxyWindow.set(key, [index, op === 'SET' ? value : null]);
for (const key of 'abcde') {
  let answer, source;
  if (proxyWindow.has(key)) { answer = proxyWindow.get(key)[1]; source = 'window'; }
  else { answer = behind.getAt(key, 5); source = 'replica at index 5'; }
  ok = ok && answer === replica.getAt(key, 8);
  console.log(`proxy at index 8 reads ${key}: ${show(answer)} from the ${source}`);
}

console.log(`log entries ${LOG.length}, checks ${ok && replica.last === 8 ? 'passed' : 'FAILED'}`);
if (!ok) process.exit(1);
