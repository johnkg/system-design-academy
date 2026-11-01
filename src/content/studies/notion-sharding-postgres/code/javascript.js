// A miniature of the migration in Notion's 2021 post "Herding elephants: Lessons learned from sharding Postgres at Notion",
// in JavaScript (a teaching model, not Notion's code): route each workspace to a logical shard and a physical database,
// double-write through an audit log, backfill a snapshot without overwriting newer records, check with dark reads, then switch.
// Everything is deterministic, so every run prints the same thing. All numbers are made up for teaching.

const LOGICAL_SHARDS = 12; // Notion has 480
const DATABASES = 3; // Notion has 32, with 15 logical shards on each
const LOST_EVENT = 2; // the catch-up script silently drops this audit event, so the checks have something to find

// 32-bit FNV-1a, used to turn a workspace id into a logical shard.
function fnv(text) {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(text)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h;
}
const shardOf = (workspace) => fnv(workspace) % LOGICAL_SHARDS;
const databaseOf = (shard) => Math.floor((shard * DATABASES) / LOGICAL_SHARDS);
const sortedKeys = (map) => [...map.keys()].sort();

// The old monolith: "workspace/block" -> version of that block.
const monolith = new Map([['ws-ada/1', 1], ['ws-ada/2', 1], ['ws-ada/3', 1], ['ws-bob/1', 1], ['ws-bob/2', 1], ['ws-bob/3', 1], ['ws-cy/1', 1], ['ws-cy/2', 1]]);
const shards = new Map(); // the new databases, seen as one map
const auditLog = []; // [key, version]

// While migrating, a write goes to the monolith (still the source of truth) and is recorded in the audit log.
function applicationWrite(key) {
  const version = (monolith.get(key) ?? 0) + 1;
  monolith.set(key, version);
  auditLog.push([key, version]);
}

// Replaying an event only ever moves a version forward, so replaying the same event twice does no harm.
function replay(index) {
  const [key, version] = auditLog[index];
  shards.set(key, Math.max(shards.get(key) ?? 0, version));
}

function darkReads() {
  const differing = sortedKeys(monolith).filter((key) => shards.get(key) !== monolith.get(key));
  console.log(`dark reads: compared ${monolith.size} rows, ${differing.length} differ${differing.length ? ` (${differing.join(', ')})` : ''}`);
  return differing.length;
}

console.log('--- routing: workspace id -> logical shard -> physical database');
for (const workspace of ['ws-ada', 'ws-bob', 'ws-cy']) {
  const shard = shardOf(workspace);
  console.log(`${workspace} -> schema${String(shard).padStart(3, '0')} on database ${databaseOf(shard)}`);
}

console.log('--- migration');
const snapshot = new Map(monolith); // the backfill copies from a snapshot taken now
['ws-ada/2', 'ws-bob/4', 'ws-cy/1'].forEach(applicationWrite);
console.log(`writes during the migration: ${auditLog.length}, all recorded in the audit log`);
replay(0); // the catch-up script gets to the first event before the backfill reaches that row
let copied = 0;
let skipped = 0;
for (const key of sortedKeys(snapshot)) {
  if ((shards.get(key) ?? 0) >= snapshot.get(key)) skipped++; // a newer record is already there
  else { shards.set(key, snapshot.get(key)); copied++; }
}
console.log(`backfill: copied ${copied} rows, skipped ${skipped} that already had a newer version`);
let replayed = 0;
for (let i = 1; i < auditLog.length; i++) {
  if (i === LOST_EVENT) continue;
  replay(i);
  replayed++;
}
console.log(`catch-up: events replayed ${replayed}, events lost 1`);
const before = darkReads();
auditLog.forEach((_, i) => replay(i)); // the repair: replay the whole log
const after = darkReads();

console.log('--- switch-over');
console.log('five-minute window: reads and writes now go to the new databases, the reverse audit log holds 0 events');
const ok = copied === 7 && skipped === 1 && before === 1 && after === 0;
console.log(`checks ${ok ? 'passed' : 'FAILED'}`);
if (!ok) process.exit(1);
