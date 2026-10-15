// A service registry in JavaScript: heartbeats renew leases, a sweep evicts expired ones,
// self-preservation stops the sweep when too many renewals vanish at once, and a client cache follows a versioned event log.
const TTL = 30, EVERY = 10, N = 20, THRESHOLD = 85; // seconds, seconds, instances, percent

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
  for (let t = 0; t <= 140; t++) {
    for (let id = 0; id < N; id++) {
      const crashed = id >= 8 && id < 10 && t >= 40;          // two instances really die at t=40
      const cut = id < 8 && t >= 40 && t < 100;               // eight healthy ones lose the registry for 60 s
      if (t % EVERY === id % EVERY && !crashed && !cut) reg.heartbeat(id, t);
    }
    reg.sweep(t); cache.catchUp(reg.log);
    if (t === 90 || t === 140) {
      const l = reg.list();
      out[t] = `listed=${l.length} healthy-missing=${[0, 1, 2, 3, 4, 5, 6, 7].filter((i) => !l.includes(i)).length} dead-listed=${l.filter((i) => i === 8 || i === 9).length}`;
    }
  }
  if (JSON.stringify([...cache.set].sort((a, b) => a - b)) !== JSON.stringify(reg.list())) process.exit(1);
  return { out, reg };
}

const results = {};
for (const sp of [false, true]) {
  const { out, reg } = run(sp); results[sp] = out;
  console.log(`self-preservation ${sp ? 'on ' : 'off'}: t=90 ${out[90]} | t=140 ${out[140]} | events=${reg.log.length} skipped-sweeps=${reg.skipped}`);
}
if (!results[false][90].startsWith('listed=10 healthy-missing=8')) process.exit(1);     // without it, a partition empties the list
if (!results[true][90].includes('healthy-missing=0')) process.exit(1);                    // with it, nobody healthy is dropped
if (!results[true][140].includes('dead-listed=0')) process.exit(1);                       // and the dead are removed once the network heals
console.log('invariants hold');
