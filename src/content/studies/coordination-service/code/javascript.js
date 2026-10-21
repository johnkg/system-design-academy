// A tiny coordination service in JavaScript: a replicated log with majority commit, a versioned key tree,
// compare-and-set, one-shot watches, sessions with ephemeral keys, and a lock built from sequential keys.

class Replica {
  constructor() { this.nodes = new Map(); this.applied = 0; this.up = true; this.slow = false; }
  apply(op) {
    const n = this.nodes.get(op.path);
    if (op.t === 'create') this.nodes.set(op.path, { data: op.data, ver: 0, owner: op.owner });
    else if (op.t === 'set') this.nodes.set(op.path, { ...n, data: op.data, ver: n.ver + 1 });
    else this.nodes.delete(op.path);
    this.applied++;
  }
}

class Cluster {
  constructor(size) {
    this.reps = Array.from({ length: size }, () => new Replica());
    this.quorum = Math.floor(size / 2) + 1;
    this.log = []; this.leader = 0; this.seq = new Map(); this.sessions = new Map(); this.watches = new Map(); this.events = [];
  }
  get state() { return this.reps[this.leader].nodes; }
  sync(r) { while (r.applied < this.log.length) r.apply(this.log[r.applied]); }
  commit(op) { // a write needs a majority of replicas that are up and keeping pace
    if (this.reps.filter((r) => r.up && !r.slow).length < this.quorum) throw new Error('no quorum');
    this.log.push(op);
    this.reps.forEach((r) => { if (r.up && !r.slow) this.sync(r); });
    const names = this.watches.get(op.path) ?? [];
    names.forEach((w) => this.events.push(`${w} saw ${op.t} ${op.path}`));
    this.watches.delete(op.path); // watches fire once
    return this.log.length; // the position in the log doubles as a transaction id
  }
  create(path, data, owner = '', sequential = false) {
    if (sequential) { const k = (this.seq.get(path) ?? 0) + 1; this.seq.set(path, k); path += String(k).padStart(3, '0'); }
    if (this.state.has(path)) throw new Error('exists');
    return { path, zxid: this.commit({ t: 'create', path, data, owner }) };
  }
  set(path, data, expected) { // compare-and-set on the version
    if (this.state.get(path).ver !== expected) throw new Error('bad version');
    this.commit({ t: 'set', path, data });
  }
  get(path, replica = this.leader, sync = false) {
    const r = this.reps[replica];
    if (sync) this.sync(r); // a linearizable read first catches up with the leader
    return r.nodes.get(path);
  }
  children(prefix) { return [...this.state.keys()].filter((p) => p.startsWith(prefix)).sort(); }
  watch(path, name) { this.watches.set(path, [...(this.watches.get(path) ?? []), name]); }
  elect() { // among the live replicas, the one with the longest log holds every committed entry
    const live = this.reps.map((r, i) => ({ r, i })).filter((x) => x.r.up);
    if (live.length < this.quorum) throw new Error('no quorum');
    this.leader = live.reduce((a, b) => (b.r.applied > a.r.applied ? b : a)).i;
  }
  open(id, now) { this.sessions.set(id, now); }
  beat(id, now) { this.sessions.set(id, now); }
  expire(now, timeout) { // a silent session loses its ephemeral keys
    for (const [id, last] of [...this.sessions]) {
      if (now - last <= timeout) continue;
      this.sessions.delete(id);
      for (const [p, n] of [...this.state]) if (n.owner === id) this.commit({ t: 'delete', path: p });
    }
  }
}

const REPLICAS = 5;
const SESSION_TIMEOUT = 5; // a session silent this long expires
const LAST_BEAT = 9; // b and c heartbeat at t=9; a went silent long before
const NOW = 10;

const c = new Cluster(REPLICAS);
c.create('/app', ''); c.create('/app/config', 'v1');
c.set('/app/config', 'v2', 0);
let stale = false; try { c.set('/app/config', 'v3', 0); } catch (e) { stale = e.message === 'bad version'; }
console.log(`config ${c.get('/app/config').data}, version ${c.get('/app/config').ver}, stale writer rejected: ${stale}`);

c.reps[4].slow = true; c.set('/app/config', 'v4', 1);
console.log(`follower 4 says ${c.get('/app/config', 4).data}; after a synced read it says ${c.get('/app/config', 4, true).data}`);
c.reps[4].slow = false;

c.reps[3].up = false; c.reps[4].up = false; c.set('/app/config', 'v5', 2);
c.reps[2].up = false; let blocked = false; try { c.set('/app/config', 'v6', 3); } catch (e) { blocked = true; }
console.log(`with 3 of 5 up the write works; with 2 of 5 up it is refused: ${blocked}`);
c.reps.forEach((r) => (r.up = true));
c.reps[0].up = false; c.elect();
console.log(`leader 0 crashed, leader ${c.leader} has config ${c.get('/app/config').data}`);

c.create('/lock', '');
const holders = [];
for (const s of ['a', 'b', 'c']) { c.open(s, 0); holders.push(c.create('/lock/n-', s, s, true)); }
const first = () => c.children('/lock/').map((p) => c.state.get(p).owner)[0];
console.log(`lock holder ${first()}, fencing token ${holders[0].zxid}`);
c.watch(holders[0].path, 'b');
c.beat('b', LAST_BEAT); c.beat('c', LAST_BEAT); c.expire(NOW, SESSION_TIMEOUT);
console.log(`session a expired, ${c.events.join('; ')}; lock holder now ${first()}, token ${holders[1].zxid}`);
if (!stale || !blocked || first() !== 'b' || holders[1].zxid <= holders[0].zxid) process.exit(1);
