// A Kafka-style partitioned log in JavaScript:
// keys pick a partition, each partition is an append-only log with a leader and followers, and a leader crash shows what each acks setting loses.

const PARTITIONS = 4, USERS = 12, EVENTS_PER_USER = 5;
const REPLICAS = 3, MESSAGES = 20, CRASH_AT = 14, NOTICED_AT = 16; // a fire-and-forget producer only notices the dead leader at message 16
const FETCH_EVERY = 4, LOST_ACK_ID = 9; // followers copy every 4th message; the ack of message 9 is lost
const BATCH = 5, CRASH_AFTER = 3; // the consumer crashes after processing 3 of a batch of 5
const fnv = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; }; // FNV-1a, a stable hash
const partitionFor = (key, count) => fnv(key) % count;

// ---- 1. Keys decide the partition, so one key's events stay in order ----
const parts = Array.from({ length: PARTITIONS }, () => []);
for (let n = 0; n < EVENTS_PER_USER; n++) for (let u = 0; u < USERS; u++) { const key = `user-${u}`; parts[partitionFor(key, PARTITIONS)].push({ key, n }); }
const inOrder = parts.every((log) => { const last = new Map(); return log.every((e) => { const ok = (last.get(e.key) ?? -1) < e.n; last.set(e.key, e.n); return ok; }); });
console.log(`partition sizes: ${parts.map((l) => l.length).join(', ')}; every key in order: ${inOrder}`);

// ---- 2. One partition with three replicas: the leader appends, followers copy ----
class Partition {
  constructor(replicas) { this.logs = Array.from({ length: replicas }, () => []); this.alive = this.logs.map(() => true); this.leader = 0; }
  append(id, idempotent) { const log = this.logs[this.leader]; if (idempotent && log.includes(id)) return; log.push(id); } // a broker remembers each producer's last sequence number; includes() stands in
  fetch() { this.logs.forEach((log, r) => { if (r !== this.leader && this.alive[r]) log.splice(0, log.length, ...this.logs[this.leader]); }); } // followers catch up to the leader
  crash() { this.alive[this.leader] = false; this.leader = -1; }
  elect() { this.leader = this.alive.indexOf(true); } // the first in-sync replica takes over; the others truncate to its log
}

function run(acks, idempotent) {
  const p = new Partition(REPLICAS); const acked = [];
  for (let id = 0; id < MESSAGES; id++) {
    if (id === CRASH_AT) p.crash();                                 // the leader dies while the producer is writing
    if (p.leader < 0) {
      if (acks === 0 && id < NOTICED_AT) { acked.push(id); continue; } // fire and forget: nobody tells the producer, and the message goes nowhere
      p.elect(); p.fetch();                                    // acks 1 or all: an error, a metadata refresh, and a retry on the new leader
    }
    p.append(id, idempotent);
    if (acks === 'all' || id % FETCH_EVERY === FETCH_EVERY - 1) p.fetch();            // acks=all waits for the followers, otherwise they copy in batches
    if (id === LOST_ACK_ID && acks !== 0) p.append(id, idempotent);      // the ack was lost on the network, so the producer retries
    acked.push(id);
  }
  const kept = p.logs[p.leader];
  const lost = acked.filter((id) => !kept.includes(id));
  return { acked: acked.length, kept: kept.length, lost, dups: kept.length - new Set(kept).size, log: kept };
}

const show = (label, r) => console.log(`${label}: acked ${r.acked}, in log ${r.kept}, acked but lost [${r.lost.join(' ')}], duplicates ${r.dups}`);
const r0 = run(0, false), r1 = run(1, false), rAll = run('all', false), rIdem = run('all', true);
show('acks=0          ', r0); show('acks=1          ', r1); show('acks=all        ', rAll); show('acks=all + idem ', rIdem);

// ---- 3. A consumer group member: the committed offset decides what happens after a crash ----
function consume(log, commitFirst) {
  let committed = 0; const processed = [];
  const batch = log.slice(committed, committed + BATCH);
  if (commitFirst) committed += batch.length;                  // commit, then process
  processed.push(...batch.slice(0, CRASH_AFTER));                       // crash after 3 messages
  const rest = log.slice(committed);                           // the restarted consumer resumes at the committed offset
  processed.push(...rest);
  const missing = log.filter((id) => !processed.includes(id)).length;
  return { missing, repeated: processed.length - new Set(processed).size };
}
const before = consume(rIdem.log, true), after = consume(rIdem.log, false);
console.log(`commit before processing: ${before.missing} missing, ${before.repeated} repeated`);
console.log(`commit after processing:  ${after.missing} missing, ${after.repeated} repeated`);

const ok = inOrder && rAll.lost.length === 0 && rIdem.dups === 0 && rIdem.log.length === MESSAGES && r1.lost.length > 0 && r0.lost.length > r1.lost.length && rAll.dups === 1
  && before.missing === 2 && after.missing === 0 && after.repeated === 3;
if (!ok) process.exit(1);
