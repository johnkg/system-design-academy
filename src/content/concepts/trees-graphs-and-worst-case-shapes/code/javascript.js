// Trees and graphs: the cost depends on the SHAPE of the tree and on how the graph is stored, not only on n.
// Part 1: insert n keys into a plain binary search tree and into an AVL tree (a self-balancing tree), count comparisons and height.
// Part 2: breadth-first search, depth-first search and Dijkstra on a graph stored as an adjacency list or an adjacency matrix.
// Look for: sorted keys turn the plain tree into a chain (height n); the matrix needs V*V cells and V*V steps; a BFS with no
// visited set never ends on a graph with a cycle; Dijkstra with a heap needs far fewer steps than Dijkstra with a scan.

// ---------- Part 1: trees ----------
function keyOrder(order, n) {
  const keys = [];
  if (order === 'sorted') for (let i = 1; i <= n; i++) keys.push(i);
  else if (order === 'zigzag') { let lo = 1, hi = n; while (lo <= hi) { keys.push(lo++); if (lo <= hi) keys.push(hi--); } }
  else { // a fixed pseudo-random permutation of 1..n (Fisher-Yates driven by an integer generator)
    for (let i = 1; i <= n; i++) keys.push(i);
    let x = 777;
    for (let i = n - 1; i > 0; i--) { x = (x * 1664525 + 1013904223) % 4294967296; const j = Math.floor(x / 65536) % (i + 1); [keys[i], keys[j]] = [keys[j], keys[i]]; }
  }
  return keys;
}

// Plain binary search tree. One comparison per node visited on the way down. Iterative, so a chain cannot overflow the stack.
function plainTree(keys) {
  const key = [], left = [], right = [];
  let comparisons = 0, height = 0;
  for (const k of keys) {
    if (key.length === 0) { key.push(k); left.push(-1); right.push(-1); height = 1; continue; }
    let at = 0, depth = 1;
    for (;;) {
      comparisons++;
      const side = k < key[at] ? left : right;
      if (side[at] === -1) { key.push(k); left.push(-1); right.push(-1); side[at] = key.length - 1; depth++; break; }
      at = side[at]; depth++;
    }
    height = Math.max(height, depth);
  }
  const lookup = (k) => { let at = 0, c = 0; while (at !== -1) { c++; if (k === key[at]) break; at = k < key[at] ? left[at] : right[at]; } return c; };
  return { comparisons, height, lookup };
}

// AVL tree: after every insert, a node whose two sides differ in height by more than 1 is rotated, so height stays below 1.45 * log2(n + 2).
function avlTree(keys) {
  let comparisons = 0;
  const h = (t) => (t ? t.h : 0);
  const fix = (t) => { t.h = 1 + Math.max(h(t.l), h(t.r)); };
  const rotR = (t) => { const l = t.l; t.l = l.r; l.r = t; fix(t); fix(l); return l; };
  const rotL = (t) => { const r = t.r; t.r = r.l; r.l = t; fix(t); fix(r); return r; };
  const insert = (t, k) => {
    if (!t) return { k, l: null, r: null, h: 1 };
    comparisons++;
    if (k < t.k) t.l = insert(t.l, k); else t.r = insert(t.r, k);
    fix(t);
    const bal = h(t.l) - h(t.r);
    if (bal > 1) { if (h(t.l.l) < h(t.l.r)) t.l = rotL(t.l); return rotR(t); }
    if (bal < -1) { if (h(t.r.r) < h(t.r.l)) t.r = rotR(t.r); return rotL(t); }
    return t;
  };
  let root = null;
  for (const k of keys) root = insert(root, k);
  const lookup = (k) => { let t = root, c = 0; while (t) { c++; if (k === t.k) break; t = k < t.k ? t.l : t.r; } return c; };
  return { comparisons, height: h(root), lookup };
}

console.log('-- n keys inserted into a plain tree and an AVL tree, then n lookups (comparisons)');
for (const n of [10, 100, 1000]) {
  for (const order of ['random', 'sorted', 'zigzag']) {
    const keys = keyOrder(order, n);
    const p = plainTree(keys), a = avlTree(keys);
    let lp = 0, la = 0;
    for (const k of keys) { lp += p.lookup(k); la += a.lookup(k); }
    console.log(`n=${n} ${order}: plain height ${p.height}, build ${p.comparisons}, lookups ${lp}; AVL height ${a.height}, build ${a.comparisons}, lookups ${la}`);
  }
  console.log(`n=${n}: the smallest possible height is ${Math.ceil(Math.log2(n + 1))}`);
}

// ---------- Part 2: graphs ----------
// A circulant graph: vertex i is joined to i+1 and i+2 (wrapping round), so every vertex has 4 neighbours and there are 2V edges.
const neighbours = (V, i) => [(i + 1) % V, (i + 2) % V, (i + V - 1) % V, (i + V - 2) % V];
const weight = (i, j) => 1 + (((i + j) * 7 + Math.abs(i - j) * 3) % 9); // symmetric, 1..9

// Breadth-first search from vertex 0. A step is a vertex taken off the queue, or an edge (list) / cell (matrix) examined.
function bfs(V, useMatrix, useVisited, cap) {
  const matrix = useMatrix ? Array.from({ length: V }, (_, i) => { const row = new Uint8Array(V); for (const j of neighbours(V, i)) row[j] = 1; return row; }) : null;
  const visited = new Uint8Array(V);
  const queue = [0]; if (useVisited) visited[0] = 1;
  let head = 0, steps = 0, reached = 1;
  while (head < queue.length) {
    if (steps >= cap) return { steps, finished: false, reached };
    const v = queue[head++]; steps++;
    if (useMatrix) { for (let j = 0; j < V; j++) { steps++; if (matrix[v][j] && !visited[j]) { visited[j] = 1; reached++; queue.push(j); } } }
    else for (const j of neighbours(V, v)) {
      steps++;
      if (!useVisited) queue.push(j); // no visited set: every edge examined is queued again
      else if (!visited[j]) { visited[j] = 1; reached++; queue.push(j); }
    }
  }
  return { steps, finished: true, reached };
}

// Recursive depth-first search on a path of V vertices (the worst shape): the recursion is V frames deep.
function dfsDepth(V) {
  const seen = new Uint8Array(V); let deepest = 0;
  const go = (v, depth) => { seen[v] = 1; deepest = Math.max(deepest, depth); for (const j of [v + 1]) if (j < V && !seen[j]) go(j, depth + 1); };
  go(0, 1);
  return deepest;
}

// Dijkstra with a binary heap (lazy deletion): counts heap comparisons, pops and edges relaxed.
function dijkstraHeap(V) {
  const dist = new Array(V).fill(Infinity), done = new Uint8Array(V), heap = [];
  let steps = 0;
  const less = (a, b) => { steps++; return a[0] < b[0]; };
  const push = (e) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (less(heap[i], heap[p])) { [heap[i], heap[p]] = [heap[p], heap[i]]; i = p; } else break; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < heap.length && less(heap[l], heap[s])) s = l; if (r < heap.length && less(heap[r], heap[s])) s = r; if (s === i) break; [heap[i], heap[s]] = [heap[s], heap[i]]; i = s; } }
    return top;
  };
  dist[0] = 0; push([0, 0]);
  while (heap.length) {
    const [d, v] = pop(); steps++;
    if (done[v]) continue;
    done[v] = 1;
    for (const j of neighbours(V, v)) { steps++; if (d + weight(v, j) < dist[j]) { dist[j] = d + weight(v, j); push([dist[j], j]); } }
  }
  return { steps, sum: dist.reduce((a, b) => a + b, 0) };
}
// Dijkstra with a scan: every round looks at all V vertices to find the nearest unfinished one.
function dijkstraScan(V) {
  const dist = new Array(V).fill(Infinity), done = new Uint8Array(V);
  let steps = 0;
  dist[0] = 0;
  for (let round = 0; round < V; round++) {
    let v = -1;
    for (let i = 0; i < V; i++) { steps++; if (!done[i] && (v === -1 || dist[i] < dist[v])) v = i; }
    done[v] = 1;
    for (const j of neighbours(V, v)) { steps++; if (dist[v] + weight(v, j) < dist[j]) dist[j] = dist[v] + weight(v, j); }
  }
  return { steps, sum: dist.reduce((a, b) => a + b, 0) };
}

// The step formulas used by the simulation (E counts each undirected edge once, so there are 2E arcs).
const formulas = {
  bfsList: (V, E) => V + 2 * E,
  bfsMatrix: (V) => V + V * V,
  dijkstraHeap: (V, E) => (V + 2 * E) * Math.ceil(Math.log2(V)),
  dijkstraScan: (V, E) => V * V + 2 * E,
  // On a matrix, finding the neighbours of a vertex scans a whole row: V cells for each of V vertices.
  dijkstraHeapMatrix: (V, E) => V * V + (V + 2 * E) * Math.ceil(Math.log2(V)),
  dijkstraScanMatrix: (V) => 2 * V * V,
  listCells: (V, E) => V + 2 * E,
  matrixCells: (V) => V * V,
};

console.log('-- breadth-first search from vertex 0, 4 neighbours per vertex (E = 2V)');
for (const V of [10, 100, 1000]) {
  const E = 2 * V;
  const l = bfs(V, false, true, 1e9), m = bfs(V, true, true, 1e9);
  console.log(`V=${V}: list ${l.steps} steps (formula ${formulas.bfsList(V, E)}), matrix ${m.steps} steps (formula ${formulas.bfsMatrix(V)}), reached ${l.reached}`);
  console.log(`V=${V}: memory list ${formulas.listCells(V, E)} cells, matrix ${formulas.matrixCells(V)} cells`);
}
console.log('-- the same search with no visited set, capped at 1000000 steps');
for (const V of [10, 100]) {
  const r = bfs(V, false, false, 1000000);
  console.log(`V=${V}: ${r.finished ? 'finished' : 'did not finish'} after ${r.steps} steps`);
}
console.log(`-- recursive depth-first search on a path of 1000 vertices: ${dfsDepth(1000)} frames deep`);
console.log('-- Dijkstra from vertex 0: heap against scan (real steps, then the formula)');
for (const V of [10, 100, 1000]) {
  const E = 2 * V;
  const h = dijkstraHeap(V), s = dijkstraScan(V);
  console.log(`V=${V}: heap ${h.steps} (formula ${formulas.dijkstraHeap(V, E)}), scan ${s.steps} (formula ${formulas.dijkstraScan(V, E)}), same distances ${h.sum === s.sum}`);
}
console.log('-- by the formulas at V = 100000 and E = 2V (sparse)');
{
  const V = 100000, E = 2 * V;
  console.log(`list ${formulas.listCells(V, E)} cells, matrix ${formulas.matrixCells(V)} cells`);
  console.log(`BFS: list ${formulas.bfsList(V, E)} steps, matrix ${formulas.bfsMatrix(V)} steps`);
  console.log(`Dijkstra: heap ${formulas.dijkstraHeap(V, E)} steps, scan ${formulas.dijkstraScan(V, E)} steps`);
  console.log(`Dijkstra on a matrix: heap ${formulas.dijkstraHeapMatrix(V, E)} steps, scan ${formulas.dijkstraScanMatrix(V)} steps`);
  console.log(`100 separate searches instead of one: ${100 * formulas.bfsList(V, E)} steps against ${formulas.bfsList(V, E)}`);
}
