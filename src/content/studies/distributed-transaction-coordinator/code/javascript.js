// Two-phase commit with a durable coordinator log and presumed abort, in JavaScript:
// participants lock and promise in phase one, the coordinator logs COMMIT before telling anyone,
// and after a crash the in-doubt participants ask the coordinator, which answers "abort" when its log has no commit record.

class Shard {
  constructor(name, balance) { this.name = name; this.balance = balance; this.lock = null; this.pending = 0; }

  prepare(tx, delta) { // phase 1: take the lock and promise, or refuse
    if (this.lock === tx) return 'yes';
    if (this.lock !== null) return `no (locked by ${this.lock})`;
    if (this.balance + delta < 0) return 'no (insufficient funds)';
    this.lock = tx; this.pending = delta; // in a real system this "prepared" record is forced to disk before replying
    return 'yes';
  }
  commit(tx) { if (this.lock === tx) { this.balance += this.pending; this.lock = null; this.pending = 0; } } // repeating it is harmless
  abort(tx) { if (this.lock === tx) { this.lock = null; this.pending = 0; } }
}

class Coordinator {
  constructor(shards) { this.shards = shards; this.log = []; } // the log survives a crash, nothing else does

  run(tx, deltas, crashAt) {
    const prepared = [];
    for (const [name, delta] of deltas) {
      const shard = this.shards[name], vote = shard.prepare(tx, delta);
      prepared.push(shard);
      if (vote !== 'yes') { // presumed abort: nothing is logged, a missing commit record means abort
        prepared.forEach((s) => s.abort(tx));
        return `${tx} aborted: ${name} voted ${vote}`;
      }
    }
    if (crashAt === 'before-decision') return `${tx} coordinator crashed before logging a decision`;
    this.log.push(`commit ${tx}`); // the decision point: forced to disk before any shard hears of it
    if (crashAt === 'after-decision') return `${tx} coordinator crashed after logging commit`;
    for (const [i, shard] of prepared.entries()) {
      shard.commit(tx);
      if (crashAt === 'mid-commit' && i === 0) return `${tx} coordinator crashed after telling ${shard.name}`;
    }
    this.log.push(`end ${tx}`);
    return `${tx} committed`;
  }

  outcome(tx) { return this.log.includes(`commit ${tx}`) ? 'commit' : 'abort'; } // presumed abort

  recover() {
    const finished = [];
    for (const shard of Object.values(this.shards)) {
      if (shard.lock === null) continue;
      const tx = shard.lock, answer = this.outcome(tx);
      if (answer === 'commit') { shard.commit(tx); if (!finished.includes(tx)) finished.push(tx); } else shard.abort(tx);
      console.log(`  ${shard.name} was in doubt about ${tx}, coordinator says ${answer}`);
    }
    finished.forEach((tx) => { if (!this.log.includes(`end ${tx}`)) this.log.push(`end ${tx}`); });
  }
}

const OPENING_BALANCE = 100;
const shards = { A: new Shard('A', OPENING_BALANCE), B: new Shard('B', OPENING_BALANCE), C: new Shard('C', OPENING_BALANCE) };
const coordinator = new Coordinator(shards);
const show = () => {
  const held = Object.values(shards).filter((s) => s.lock).map((s) => `${s.name}:${s.lock}`).join(',');
  console.log(`  ${Object.values(shards).map((s) => `${s.name}=${s.balance}`).join(' ')} locks=[${held}]`);
};
const total = () => Object.values(shards).reduce((sum, s) => sum + s.balance, 0);

const plan = [
  ['tx1', [['A', -30], ['B', 30]], null],
  ['tx2', [['B', -50], ['C', 50]], 'before-decision'],
  ['tx3', [['A', -10], ['B', 10]], null], // B is still locked by the in-doubt tx2
  ['recover'],
  ['tx4', [['A', -20], ['C', 20]], 'after-decision'],
  ['recover'],
  ['tx5', [['C', -40], ['B', 40]], 'mid-commit'],
  ['recover'],
  ['tx6', [['A', -500], ['C', 500]], null],
];
for (const [tx, deltas, crashAt] of plan) {
  if (tx === 'recover') { console.log('  coordinator restarts and recovers'); coordinator.recover(); } else console.log(coordinator.run(tx, deltas, crashAt));
  show();
}
console.log(`log: ${coordinator.log.join(', ')}`);
const clean = Object.values(shards).every((s) => s.lock === null);
console.log(`money total ${total()}, all locks released: ${clean}`);
if (total() !== OPENING_BALANCE * Object.keys(shards).length || !clean || coordinator.log.some((r) => r.startsWith('abort'))) process.exit(1);
