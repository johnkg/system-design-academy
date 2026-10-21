// A service registry in JavaScript: heartbeats renew leases, a sweep evicts expired ones,
// self-preservation stops the sweep when too many renewals vanish at once, and a client cache follows a versioned event log.
const TTL = 30, EVERY = 10, N = 20, THRESHOLD = 85; // seconds, seconds, instances, percent
// The scenario: from FAULT_AT, instances 0..CUT-1 lose the registry until HEAL_AT, and CUT..DEAD_END-1 die for good.
const FAULT_AT = 40, HEAL_AT = 100, END = 140, CHECK_AT = 90, CUT = 8, DEAD_END = 10;

class Registry {
  constructor(selfPreservation) {
    this.sp = selfPreservation; this.last = new Map(); this.renewals = []; // renewals: the times of recent heartbeats
    this.log = []; this.skipped = 0;                                        // log: versioned changes that watchers receive
  }
  heartbeat(id, now) {
    if (!this.last.has(id)) this.log.push({ v: this.log.length + 1, op: 'add', id }); // an unknown id registers again
    this.last.set(id, now); this.renewals.push(now);
  }
  sweep(now) {
    this.renewals = this.renewals.filter((t) => t > now - TTL);
    const expected = this.last.size * (TTL / EVERY);
    if (this.sp && this.renewals.length * 100 < THRESHOLD * expected) { this.skipped++; return; } // too many silent: suspect the network, not the instances
    for (const [id, seen] of [...this.last]) {
      if (now - seen > TTL) { this.last.delete(id); this.log.push({ v: this.log.length + 1, op: 'evict', id }); }
    }
  }
  list() { return [...this.last.keys()].sort((a, b) => a - b); }
}

class ClientCache { // applies the log in order, and asks for a full copy if it ever sees a gap
  constructor() { this.version = 0; this.set = new Set(); }
  catchUp(log) {
    for (const e of log.filter((x) => x.v > this.version)) {
      if (e.v !== this.version + 1) throw new Error('gap');
      if (e.op === 'add') this.set.add(e.id); else this.set.delete(e.id);
      this.version = e.v;
    }
  }
}

function run(selfPreservation) {
  const reg = new Registry(selfPreservation), cache = new ClientCache(), out = {};
  for (let t = 0; t <= END; t++) {
    for (let id = 0; id < N; id++) {
      const crashed = id >= CUT && id < DEAD_END && t >= FAULT_AT; // two instances really die at t=40
      const cut = id < CUT && t >= FAULT_AT && t < HEAL_AT;       // eight healthy ones lose the registry for 60 s
      if (t % EVERY === id % EVERY && !crashed && !cut) reg.heartbeat(id, t);
    }
    reg.sweep(t); cache.catchUp(reg.log);
    if (t === CHECK_AT || t === END) {
      const l = reg.list();
      out[t] = `listed=${l.length} healthy-missing=${Array.from({ length: CUT }, (_, i) => i).filter((i) => !l.includes(i)).length} dead-listed=${l.filter((i) => i >= CUT && i < DEAD_END).length}`;
    }
  }
  if (JSON.stringify([...cache.set].sort((a, b) => a - b)) !== JSON.stringify(reg.list())) process.exit(1);
  return { out, reg };
}

const results = {};
for (const sp of [false, true]) {
  const { out, reg } = run(sp); results[sp] = out;
  console.log(`self-preservation ${sp ? 'on ' : 'off'}: t=90 ${out[CHECK_AT]} | t=140 ${out[END]} | events=${reg.log.length} skipped-sweeps=${reg.skipped}`);
}
if (!results[false][CHECK_AT].startsWith('listed=10 healthy-missing=8')) process.exit(1);     // without it, a partition empties the list
if (!results[true][CHECK_AT].includes('healthy-missing=0')) process.exit(1);                    // with it, nobody healthy is dropped
if (!results[true][END].includes('dead-listed=0')) process.exit(1);                       // and the dead are removed once the network heals
console.log('invariants hold');
