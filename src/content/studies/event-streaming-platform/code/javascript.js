// The core of an event streaming platform, in JavaScript:
// keys pick a partition, an idempotent producer survives lost acknowledgements without duplicates,
// a consumer group resumes from committed offsets after a crash, and compaction keeps the latest value per key.

const fnv = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; };

let seed = 7;
const roll = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % 100; }; // 0..99, deterministic

class Partition {
  constructor() { this.log = []; this.lastSeq = new Map(); } // lastSeq: the latest sequence number seen from each producer
  append(producerId, seq, key, value, idempotent) {
    if (idempotent) {
      const last = this.lastSeq.has(producerId) ? this.lastSeq.get(producerId) : -1;
      if (seq <= last) return 'duplicate';      // a retry of something already stored: acknowledge it, store nothing
      if (seq > last + 1) return 'out of order'; // a gap: refuse, so the producer must resend in order
      this.lastSeq.set(producerId, seq);
    }
    this.log.push({ key, value });
    return 'appended';
  }
}

// One producer sends 40 events. Every request or acknowledgement is lost 20% of the time, and the producer then retries.
function produce(idempotent) {
  seed = 7;
  const parts = [new Partition(), new Partition(), new Partition()];
  const nextSeq = [0, 0, 0];
  let retries = 0;
  for (let i = 0; i < 40; i++) {
    const key = `user-${i % 7}`, p = fnv(key) % 3, seq = nextSeq[p]++;
    for (;;) {
      if (roll() < 20) { retries++; continue; }           // the request never arrived
      parts[p].append(1, seq, key, i, idempotent);
      if (roll() < 20) { retries++; continue; }           // it was stored, but the acknowledgement was lost
      break;
    }
  }
  return { parts, retries, total: parts.reduce((n, x) => n + x.log.length, 0) };
}

const plain = produce(false);
console.log(`without idempotence: ${plain.total} records stored for 40 sent, ${plain.total - 40} duplicates, ${plain.retries} retries`);
const safe = produce(true);
console.log(`with idempotence: ${safe.total} records stored for 40 sent, ${safe.total - 40} duplicates, ${safe.retries} retries`);
console.log(`partition sizes: ${safe.parts.map((x) => x.log.length).join(' ')}`);

// Within each partition every key's values must be in the order they were sent.
const inOrder = safe.parts.every((x) => {
  const seen = new Map();
  return x.log.every((r) => { const ok = r.value > (seen.get(r.key) ?? -1); seen.set(r.key, r.value); return ok; });
});

// A consumer group: member b owns partition 1 and commits after each batch of 4. It crashes after processing 11 records.
const log1 = safe.parts[1].log;
const crashAt = Math.min(11, log1.length);
const committed = Math.floor(crashAt / 4) * 4;
const rereadBy = log1.slice(committed).length;  // member a takes over and starts from the committed offset
const processedTwice = crashAt - committed;
console.log(`group: b processed ${crashAt} records of partition 1 and committed ${committed}; a resumed at ${committed} and read ${rereadBy}, so ${processedTwice} were processed twice`);

// Compaction keeps only the newest record for each key, in log order.
function compact(log) {
  const lastAt = new Map(); log.forEach((r, i) => lastAt.set(r.key, i));
  return log.filter((r, i) => lastAt.get(r.key) === i);
}
const kept = compact(safe.parts[2].log);
console.log(`compaction of partition 2: ${safe.parts[2].log.length} records -> ${kept.length}, kept ${kept.map((r) => `${r.key}=${r.value}`).join(' ')}`);

const ok = safe.total === 40 && plain.total > 40 && inOrder && processedTwice === 3 && new Set(kept.map((r) => r.key)).size === kept.length;
console.log(`all invariants hold: ${ok}`);
if (!ok) process.exit(1);
