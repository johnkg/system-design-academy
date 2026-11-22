// Shortest paths, counted in steps: Dijkstra with a binary heap and with a plain array, Bellman-Ford, and A* on a grid.
// A step is one comparison inside the heap, one node looked at while scanning for the closest unsettled one, or one edge checked
// ("relaxed"). Nothing is timed.
// Look for: the heap wins on sparse graphs and can lose on dense ones; one negative edge makes Dijkstra return wrong distances
// without any error while Bellman-Ford stays right (and spots a negative cycle); a good A* heuristic expands a fraction of the
// nodes Dijkstra does, and one that overestimates saves even more but returns a longer path.
// Graphs come from fixed integer formulas. A heap entry is priority * KEY + node, so equal priorities are ordered by node.

const INF = 1000000000;
const KEY = 100000;
const OFFSET = 1000000; // added to a distance inside a heap key, so a negative distance still gives a positive key
const TIE = 4096; // A* priority is f * TIE - g: among equal f, the node with the larger g (closer to the goal) goes first

class Heap {
  constructor() { this.a = []; this.c = 0; } // c counts comparisons inside the heap
  push(key) {
    const a = this.a;
    a.push(key);
    let i = a.length - 1;
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      this.c++;
      if (key < a[p]) { a[i] = a[p]; i = p; } else break;
    }
    a[i] = key;
  }
  pop() {
    const a = this.a;
    const top = a[0], last = a.pop();
    if (a.length > 0) {
      const n = a.length;
      let i = 0;
      for (;;) {
        let s = 2 * i + 1;
        if (s >= n) break;
        if (s + 1 < n) {
          this.c++;
          if (a[s + 1] < a[s]) s++;
        }
        this.c++;
        if (a[s] < last) { a[i] = a[s]; i = s; } else break;
      }
      a[i] = last;
    }
    return top;
  }
}

function makeGraph(kind, v) {
  const adj = Array.from({ length: v }, () => []);
  for (let i = 0; i < v; i++) {
    if (kind === "sparse") { // three edges per node, weights 1 to 20
      for (let k = 0; k < 3; k++) {
        let t = (i * (2 * k + 3) * 7919 + k * 104729 + 13) % v;
        if (t === i) t = (t + 1) % v;
        adj[i].push([t, 1 + ((i * 31 + k * 17 + t * 7) % 20)]);
      }
    } else if (kind === "dense") { // each node points at half of the others
      for (let k = 0; k < Math.floor(v / 2); k++) {
        const t = (i + 1 + 2 * k + (i % 2)) % v;
        if (t !== i) adj[i].push([t, 1 + ((i * 31 + t * 17) % 20)]);
      }
    } else if (kind === "adversarial") { // every edge improves a distance when it is relaxed, so the heap gets a push for each
      for (let t = i + 1; t < v; t++) adj[i].push([t, t === i + 1 ? 1 : 3 * (v - i) + (t - i)]);
    } else if (kind === "backward") { // a chain whose edges point against the order Bellman-Ford sweeps the nodes in: from the last node, one hop per round
      if (i > 0) adj[i].push([i - 1, 1]);
    } else { // "negative": a layered graph, edges only forward, weights -4 to 10: no cycles, so no negative cycle
      for (let t = i + 1; t < Math.min(v, i + 4); t++) adj[i].push([t, ((i * 37 + t * 11) % 15) - 4]);
    }
  }
  return adj;
}

function dijkstraArray(adj, src) {
  const v = adj.length;
  const dist = new Array(v).fill(INF), done = new Array(v).fill(false);
  dist[src] = 0;
  let steps = 0;
  for (;;) {
    let best = -1;
    for (let u = 0; u < v; u++) { // scan every node for the closest one not settled yet
      steps++;
      if (!done[u] && dist[u] < INF && (best < 0 || dist[u] < dist[best])) best = u;
    }
    if (best < 0) break;
    done[best] = true;
    for (const [t, w] of adj[best]) {
      steps++;
      if (dist[best] + w < dist[t]) dist[t] = dist[best] + w;
    }
  }
  return [dist, steps];
}

function dijkstraHeap(adj, src) {
  const v = adj.length;
  const dist = new Array(v).fill(INF), done = new Array(v).fill(false);
  dist[src] = 0;
  const h = new Heap();
  let edges = 0, pushes = 1;
  h.push(OFFSET * KEY + src);
  while (h.a.length > 0) {
    const u = h.pop() % KEY;
    if (done[u]) continue; // a stale entry: the node was already settled with a smaller distance
    done[u] = true;
    for (const [t, w] of adj[u]) {
      edges++;
      if (dist[u] + w < dist[t]) { dist[t] = dist[u] + w; h.push((dist[t] + OFFSET) * KEY + t); pushes++; }
    }
  }
  return [dist, h.c + edges, pushes];
}

function bellmanFord(adj, src) {
  const v = adj.length;
  const dist = new Array(v).fill(INF);
  dist[src] = 0;
  let relax = 0, rounds = 0;
  for (let r = 0; r < v; r++) {
    let changed = false;
    rounds++;
    for (let u = 0; u < v; u++) {
      if (dist[u] === INF) continue;
      for (const [t, w] of adj[u]) {
        relax++;
        if (dist[u] + w < dist[t]) { dist[t] = dist[u] + w; changed = true; }
      }
    }
    if (!changed) return [dist, relax, rounds, false];
  }
  return [dist, relax, rounds, true]; // still improving after v rounds: a negative cycle is reachable
}

const edgeCount = (adj) => adj.reduce((s, x) => s + x.length, 0);

console.log("-- Dijkstra from node 0: heap against array (steps)");
for (const kind of ["sparse", "dense", "adversarial"]) {
  for (const v of [100, 1000]) {
    const adj = makeGraph(kind, v);
    const [da, sa] = dijkstraArray(adj, 0);
    const [dh, sh, pushes] = dijkstraHeap(adj, 0);
    if (da.join() !== dh.join()) throw new Error("the two implementations disagree");
    console.log(`${kind} V=${v} E=${edgeCount(adj)}: array ${sa}, heap ${sh} (${pushes} pushes)`);
  }
}

console.log("-- negative edge weights: Dijkstra (settle each node once) against Bellman-Ford");
for (const v of [100, 1000]) {
  const adj = makeGraph("negative", v);
  const [bf, relax, rounds] = bellmanFord(adj, 0);
  const [dj, steps] = dijkstraHeap(adj, 0);
  let wrong = 0, worst = 0;
  for (let i = 0; i < v; i++) { if (bf[i] !== dj[i]) wrong++; worst = Math.max(worst, dj[i] - bf[i]); }
  console.log(`V=${v} E=${edgeCount(adj)}: Bellman-Ford ${relax} edge checks in ${rounds} rounds; Dijkstra ${steps} steps and wrong for ${wrong} of ${v} nodes (too long by up to ${worst})`);
}

// The smallest example: A -> B costs 3, A -> C costs 5, C -> B costs -4, B -> D costs 1. The best way to B is through C and costs 1.
const triangle = [[[1, 3], [2, 5]], [[3, 1]], [[1, -4]], []];
const dt = dijkstraHeap(triangle, 0)[0], bt = bellmanFord(triangle, 0)[0];
console.log(`four nodes, A->B 3, A->C 5, C->B -4, B->D 1: Dijkstra says B costs ${dt[1]} and D costs ${dt[3]}; Bellman-Ford says B costs ${bt[1]} and D costs ${bt[3]}`);

// 0 -> 1 costs 2, 1 -> 2 costs -3, 2 -> 1 costs 1: going round 1 -> 2 -> 1 costs -2 each time.
const cycle = [[[1, 2]], [[2, -3]], [[1, 1]]];
{
  const [, relax, rounds, cyc] = bellmanFord(cycle, 0);
  console.log(`negative cycle: Bellman-Ford still improving after ${rounds} rounds (${relax} edge checks), so it reports a cycle: ${cyc}`);
}

console.log("-- Bellman-Ford against Dijkstra with a heap, all weights positive (steps)");
for (const v of [100, 1000]) {
  const adj = makeGraph("sparse", v);
  const [, relax, rounds] = bellmanFord(adj, 0);
  const [, sh] = dijkstraHeap(adj, 0);
  console.log(`sparse V=${v}: Bellman-Ford ${relax} edge checks in ${rounds} rounds, Dijkstra ${sh}`);
}
for (const v of [100, 1000]) {
  const adj = makeGraph("backward", v);
  const [, relax, rounds] = bellmanFord(adj, v - 1);
  const [, sh] = dijkstraHeap(adj, v - 1);
  console.log(`backward chain V=${v}: Bellman-Ford ${relax} edge checks in ${rounds} rounds, Dijkstra ${sh}`);
}

// a few blocked cells (null), start and goal always open
function gridOpen(w, x, y) {
  if ((x === 0 && y === 0) || (x === w - 1 && y === w - 1)) return true;
  return (x * 31 + y * 17) % 11 !== 0;
}

// Moves cost 1. The heuristic is factor * (Manhattan distance to the goal): 0 is plain Dijkstra, 1 never overestimates, 3 does.
function aStar(w, factor) {
  const n = w * w, goal = n - 1;
  const g = new Array(n).fill(INF), closed = new Array(n).fill(false);
  g[0] = 0;
  const h = new Heap();
  let expanded = 0;
  h.push(factor * (2 * (w - 1)) * TIE * KEY);
  while (h.a.length > 0) {
    const u = h.pop() % KEY;
    if (closed[u]) continue;
    closed[u] = true;
    expanded++;
    if (u === goal) return [expanded, g[u]];
    const x = u % w, y = Math.floor(u / w);
    for (const [nx, ny] of [[x + 1, y], [x, y + 1], [x - 1, y], [x, y - 1]]) {
      if (nx >= 0 && nx < w && ny >= 0 && ny < w && gridOpen(w, nx, ny)) {
        const t = ny * w + nx;
        if (g[u] + 1 < g[t]) {
          g[t] = g[u] + 1;
          h.push(((g[t] + factor * ((w - 1 - nx) + (w - 1 - ny))) * TIE - g[t]) * KEY + t);
        }
      }
    }
  }
  return [expanded, -1];
}

console.log("-- A* on a grid with some blocked cells: nodes expanded before reaching the far corner");
for (const w of [20, 50, 100]) {
  const row = [];
  for (const [name, factor] of [["no heuristic (Dijkstra)", 0], ["Manhattan distance", 1], ["3 x Manhattan distance", 3]]) {
    const [expanded, cost] = aStar(w, factor);
    row.push(`${name}: ${expanded} expanded, path cost ${cost}`);
  }
  console.log(`${w}x${w} grid (${w * w} cells): ` + row.join("; "));
}
