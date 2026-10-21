// A property graph with adjacency lists, in JavaScript:
// every node holds a direct list of its neighbours, so a hop is a list read. Supernodes are not expanded, and a hash splits nodes over shards.

const SHARDS = 4;
// Knuth's multiplicative hash (2654435761 is about 2^32 / golden ratio).
const shardOf = (id) => (Math.imul(id, 2654435761) >>> 16) % SHARDS; // the high bits of the product are well mixed

class Graph {
  constructor(n) { this.adj = Array.from({ length: n }, () => []); this.props = Array.from({ length: n }, (_, i) => ({ name: `user${i}` })); this.edges = []; }
  addEdge(a, b) { this.adj[a].push(b); this.adj[b].push(a); this.edges.push([a, b]); } // a friendship is stored on both ends
  degree(id) { return this.adj[id].length; }

  // Breadth-first walk of k hops. A node with more than `cap` neighbours is reached but not expanded.
  walk(start, k, cap) {
    const seen = new Set([start]);
    let frontier = [start], examined = 0, cross = 0;
    const levels = [];
    for (let hop = 0; hop < k; hop++) {
      const next = [];
      for (const u of frontier) {
        if (this.degree(u) > cap) continue;          // do not open a supernode
        for (const v of this.adj[u]) {
          examined++;
          if (shardOf(u) !== shardOf(v)) cross++;    // this step would be a network call
          if (!seen.has(v)) { seen.add(v); next.push(v); }
        }
      }
      levels.push(next.length);
      frontier = next;
    }
    return { levels, seen, examined, cross };
  }
}

const SEED = 7, FRIENDS_PER_USER = 3, START = 5, HOPS = 3, DEGREE_CAP = 50;
let seed = SEED;
// Linear congruential generator (Numerical Recipes constants), high 16 bits.
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

const N = 400, graph = new Graph(N);
for (let i = 1; i < N; i++) graph.addEdge(0, i);        // node 0 is a celebrity that everyone follows
for (let i = 1; i < N; i++) for (let j = 0; j < FRIENDS_PER_USER; j++) { const b = 1 + random(N - 1); if (b !== i) graph.addEdge(i, b); }

const maxDegree = Math.max(...graph.adj.map((a) => a.length));
console.log(`nodes ${N}, edges ${graph.edges.length}, supernode degree ${graph.degree(0)}, median degree ${graph.adj.map((a) => a.length).sort((a, b) => a - b)[N >> 1]}`);

const show = (label, r) => console.log(`${label}: new nodes per hop [${r.levels.join(', ')}], reached ${r.seen.size}, edges examined ${r.examined}, cross-shard ${r.cross}`);
const full = graph.walk(START, HOPS, Infinity), capped = graph.walk(START, HOPS, DEGREE_CAP);
show('3 hops, expand everything ', full);
show('3 hops, skip nodes over 50', capped);

// Check the walk against the slow way: scan the whole edge list once per hop.
let reach = new Set([START]);
for (let hop = 0; hop < HOPS; hop++) {
  const grown = new Set(reach);
  for (const [a, b] of graph.edges) { if (reach.has(a)) grown.add(b); if (reach.has(b)) grown.add(a); }
  reach = grown;
}
const same = reach.size === full.seen.size && [...reach].every((x) => full.seen.has(x));
const saved = Math.floor((100 * (full.examined - capped.examined)) / full.examined);
console.log(`matches the edge-list scan: ${same}; the cap saves ${saved}% of the edge reads; max degree ${maxDegree}`);
if (!same || capped.examined >= full.examined || maxDegree !== graph.degree(0)) process.exit(1);
