// Three ideas from LinkedIn's 2014 post on Kafka, as a small model in JavaScript (not LinkedIn's or Kafka's code):
// 1. A topic is a set of append-only logs (partitions). A key picks the partition and each record gets an offset.
// 2. Consumers share one log. Each keeps its own position, commits it now and then, and a replacement resumes from the commit.
// 3. A follower copy lags the leader. Consumers only see records every copy has, and the acknowledgement mode decides
//    what the producer was promised before the leader is lost.
// Everything is deterministic, so every run prints the same thing.
const PARTITIONS = 3;

function hashOf(key) {
  let h = 7;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 1000003;
  return h;
}

// 1. Keys, partitions and offsets.
const logs = Array.from({ length: PARTITIONS }, () => []);
const sends = ['ann', 'bob', 'hal', 'ann', 'jo', 'bob', 'ann', 'hal'];
for (const key of sends) logs[hashOf(key) % PARTITIONS].push(key);
console.log(`${sends.length} records over ${PARTITIONS} partitions`);
logs.forEach((log, p) => console.log(`  partition ${p}: offsets 0..${log.length - 1} hold [${log.join(', ')}]`));
const annPartitions = new Set(logs.map((log, p) => (log.includes('ann') ? p : -1)).filter((p) => p >= 0));
console.log(`  every record for key ann is in ${annPartitions.size} partition`);

// 2. One shared log, two consumers with their own positions, and a crash.
const shared = Array.from({ length: 10 }, (_, i) => `r${i}`);
const COMMIT_EVERY = 4;
function consume(from, upTo, crashAfter) {
  const seen = [];
  let committed = from;
  for (let offset = from; offset < upTo; offset++) {
    if (seen.length === crashAfter) break;
    seen.push(offset);
    if ((offset + 1) % COMMIT_EVERY === 0) committed = offset + 1;
  }
  return { seen, committed };
}
const reporting = consume(0, shared.length, Infinity);
const worker = consume(0, shared.length, 6); // processes offsets 0..5, then crashes
const replacement = consume(worker.committed, shared.length, Infinity);
const again = worker.seen.filter((o) => replacement.seen.includes(o));
console.log(`log of ${shared.length} records, stored once for both consumers`);
console.log(`  reporting job read ${reporting.seen.length} records, offsets ${reporting.seen[0]}..${reporting.seen.at(-1)}`);
console.log(`  worker crashed after offset ${worker.seen.at(-1)} with offset ${worker.committed} committed`);
console.log(`  replacement starts at offset ${replacement.seen[0]} and sees offset ${again.join(', ')} a second time`);

// 3. A leader with 10 records, a follower that has fetched 7, and a lost leader.
const leader = 10, follower = 7;
const visible = Math.min(leader, follower);
console.log(`leader holds ${leader} records, follower holds ${follower}, consumers can read offsets 0..${visible - 1}`);
for (const mode of ['leader only', 'all in-sync copies']) {
  const acknowledged = mode === 'leader only' ? leader : follower;
  const lost = Math.max(0, acknowledged - follower);
  console.log(`  ack = ${mode}: producer told ${acknowledged} are safe, leader lost, ${lost} acknowledged records gone`);
}

if (annPartitions.size !== 1 || again.length !== 2 || visible !== 7) process.exit(1);
