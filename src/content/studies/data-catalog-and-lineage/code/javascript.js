// A lineage catalog in JavaScript: idempotent ingestion of run events, a graph walked downstream for impact analysis,
// owners to notify, and a search that ranks by how much depends on an asset.

class Catalog {
  constructor() { this.seen = new Set(); this.edges = []; this.down = new Map(); this.up = new Map(); }

  link(map, a, b) { if (!map.has(a)) map.set(a, []); map.get(a).push(b); }

  // One run event says which assets a job read and wrote. A repeated event id is ignored.
  ingest(ev) {
    if (this.seen.has(ev.id)) return false;
    this.seen.add(ev.id);
    for (const out of ev.outputs) {
      for (const inp of ev.inputs) {
        if ((this.down.get(inp) ?? []).includes(out)) continue; // the edge is already known
        this.edges.push([inp, out]); this.link(this.down, inp, out); this.link(this.up, out, inp);
      }
    }
    return true;
  }

  // Breadth-first walk with a depth limit; a visited map makes cycles harmless. Returns asset -> hops from the start.
  reach(map, start, maxDepth) {
    const hops = new Map([[start, 0]]);
    let frontier = [start];
    for (let d = 1; d <= maxDepth && frontier.length > 0; d++) {
      const next = [];
      for (const u of frontier) for (const v of map.get(u) ?? []) if (!hops.has(v)) { hops.set(v, d); next.push(v); }
      frontier = next;
    }
    hops.delete(start);
    return hops;
  }

  search(query) {
    const names = new Set(this.edges.flat());
    const score = (n) => (n === query ? 1000 : 0) + 10 * (this.down.get(n) ?? []).length;
    return [...names].filter((n) => n.includes(query)).sort((a, b) => score(b) - score(a) || (a < b ? -1 : 1));
  }
}

let seed = 7;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

const catalog = new Catalog();
let accepted = 0;
for (let k = 0; k < 300; k++) {
  const out = 20 + random(180);                       // asset names t20..t199; inputs always have a lower number, so the graph is acyclic
  const inputs = [...new Set([random(out), random(out)])].map((i) => `t${i}`);
  const ev = { id: `e${k}`, inputs, outputs: [`t${out}`] };
  for (let delivery = 0; delivery < 2; delivery++) if (catalog.ingest(ev)) accepted++; // every event arrives twice
}
console.log(`events accepted: ${accepted} of 600 deliveries, edges: ${catalog.edges.length}`);

const hops = (limit) => catalog.reach(catalog.down, 't0', limit);
console.log(`t0 impact: ${hops(1).size} at 1 hop, ${hops(2).size} within 2 hops, ${hops(99).size} in all`);
console.log(`t0 is ${Math.max(...hops(99).values())} hops from its farthest consumer, and ${catalog.reach(catalog.up, 't199', 99).size} assets feed t199`);

const teams = [...new Set([...hops(99).keys()].map((n) => `team-${Number(n.slice(1)) % 5}`))].sort();
console.log(`teams to notify: ${teams.join(', ')}`);
console.log(`search "t1": ${catalog.search('t1').slice(0, 3).join(', ')}`);

// Check against the slow, obvious method: keep relaxing every edge until nothing changes.
const slow = new Set(['t0']);
for (let changed = true; changed;) { changed = false; for (const [a, b] of catalog.edges) if (slow.has(a) && !slow.has(b)) { slow.add(b); changed = true; } }
slow.delete('t0');
const same = slow.size === hops(99).size && [...slow].every((n) => hops(99).has(n));
catalog.ingest({ id: 'cycle', inputs: ['t150'], outputs: ['t0'] }); // a feedback loop must not hang the walk
const survives = hops(99).size === slow.size;
console.log(`matches the slow method: ${same}; survives a cycle: ${survives}`);
if (!same || !survives || accepted !== 300) process.exit(1);
