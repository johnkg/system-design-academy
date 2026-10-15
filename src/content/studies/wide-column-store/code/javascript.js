// A tiny Cassandra-style cluster in JavaScript: a consistent-hash ring with virtual nodes,
// replication factor 3, quorum reads and writes, hinted handoff, read repair and tombstones.
const RF = 3, NAMES = ['n0', 'n1', 'n2', 'n3', 'n4'];

const fnv1a = (s) => { // 32-bit FNV-1a, integer maths only
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; // finalizer: FNV-1a alone spreads similar keys poorly
  return (h ^ (h >>> 13)) >>> 0;
};

class Ring {
  constructor(vnodes) {
    this.tokens = NAMES.flatMap((n) => Array.from({ length: vnodes }, (_, v) => ({ t: fnv1a(`${n}#${v}`), n })));
    this.tokens.sort((a, b) => a.t - b.t);
  }
  replicas(key) { // walk clockwise from the key's position and collect RF distinct nodes
    const h = fnv1a(key), i = Math.max(0, this.tokens.findIndex((x) => x.t >= h));
    const order = [...this.tokens.slice(i), ...this.tokens.slice(0, i)].map((x) => x.n);
    return [...new Set(order)].slice(0, RF);
  }
}

function spread(vnodes) { // how many of 1000 keys each node is the first replica for
  const ring = new Ring(vnodes), counts = {};
  for (let i = 0; i < 1000; i++) { const p = ring.replicas(`k${i}`)[0]; counts[p] = (counts[p] || 0) + 1; }
  return Object.values(counts);
}

class Cluster {
  constructor() {
    this.ring = new Ring(16); this.up = new Set(NAMES); this.hints = [];
    this.data = new Map(NAMES.map((n) => [n, new Map()]));
  }
  apply(node, key, cell) { // last write wins
    const m = this.data.get(node), cur = m.get(key);
    if (!cur || cell.ts > cur.ts) m.set(key, cell);
  }
  write(key, value, ts, w) { // a delete is a write of value null, a tombstone
    let acks = 0;
    for (const n of this.ring.replicas(key)) {
      if (this.up.has(n)) { this.apply(n, key, { ts, value }); acks++; }
      else this.hints.push({ to: n, key, cell: { ts, value } }); // hinted handoff
    }
    return acks >= w;
  }
  replay(node) {
    const mine = this.hints.filter((h) => h.to === node);
    mine.forEach((h) => this.apply(node, h.key, h.cell));
    this.hints = this.hints.filter((h) => h.to !== node);
    return mine.length;
  }
  read(key, r) {
    const live = this.ring.replicas(key).filter((n) => this.up.has(n));
    if (live.length < r) throw new Error('not enough replicas for this read');
    const cells = live.map((n) => this.data.get(n).get(key));
    const newest = cells.reduce((a, c) => (c && (!a || c.ts > a.ts) ? c : a), null);
    const stale = live.filter((n, i) => newest && (!cells[i] || cells[i].ts < newest.ts));
    stale.forEach((n) => this.apply(n, key, newest)); // read repair
    return { value: newest.value, repairs: stale.length };
  }
  purge(before) { // compaction drops tombstones older than the grace period
    for (const m of this.data.values()) for (const [k, c] of [...m]) if (c.value === null && c.ts < before) m.delete(k);
  }
}

const [s1, s64] = [spread(1), spread(64)], gap = (a) => Math.max(...a) - Math.min(...a);
console.log(`1 vnode: busiest ${Math.max(...s1)}, quietest ${Math.min(...s1)}; 64 vnodes: busiest ${Math.max(...s64)}, quietest ${Math.min(...s64)}`);
if (gap(s64) >= gap(s1)) process.exit(1);

for (let w = 1; w <= RF; w++) for (let r = 1; r <= RF; r++) { // worst case: the read set and write set overlap as little as possible
  const f = new Cluster(), rs = f.ring.replicas('x');
  rs.forEach((n) => f.apply(n, 'x', { ts: 1, value: 'old' }));
  rs.slice(0, w).forEach((n) => f.apply(n, 'x', { ts: 2, value: 'new' }));
  const sees = rs.slice(RF - r).some((n) => f.data.get(n).get('x').value === 'new');
  console.log(`W=${w} R=${r} reads the new value: ${sees}`);
  if (sees !== (r + w > RF)) process.exit(1);
}

const c = new Cluster(), key = 'user:42', down = c.ring.replicas(key)[2];
console.log(`${key} lives on ${c.ring.replicas(key).join(', ')}`);
c.write(key, 'v1', 1, 2); c.up.delete(down);
const ok = c.write(key, 'v2', 2, 2);
console.log(`${down} down: write ok=${ok}, hints=${c.hints.length}, read=${c.read(key, 2).value}`);
c.up.add(down);
console.log(`${down} back: replayed ${c.replay(down)} hint, it holds ${c.data.get(down).get(key).value}`);

c.up.delete(down); c.write(key, 'v3', 3, 2); c.hints = []; c.up.add(down); // the hint expires before the node returns
const rr = c.read(key, 2);
console.log(`hint lost: read=${rr.value}, repairs=${rr.repairs}, ${down} now holds ${c.data.get(down).get(key).value}`);
if (rr.value !== 'v3' || rr.repairs !== 1) process.exit(1);

function deleteWhileDown(k, purge) { // the third replica misses the delete
  const rs = c.ring.replicas(k);
  c.write(k, 'v3', 3, 3); c.up.delete(rs[2]);
  c.write(k, null, 4, 2); c.hints = [];
  if (purge) c.purge(5);
  c.up.add(rs[2]);
  const res = c.read(k, 3);
  return `${k} purge=${purge}: read=${res.value === null ? 'deleted' : res.value}, repairs=${res.repairs}`;
}
const kept = deleteWhileDown('user:7', false), zombie = deleteWhileDown('user:8', true);
console.log(kept + '\n' + zombie);
if (!kept.includes('deleted') || !zombie.includes('read=v3')) process.exit(1);
