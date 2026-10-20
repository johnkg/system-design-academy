// A road grid in JavaScript: Dijkstra and A* find the same cheapest route, but A* settles far fewer cells.
// Each cell takes 2 or 3 minutes to cross, about one cell in eight is blocked, and a jam can make cells slower.
const W = 24, H = 16, MIN_COST = 2;
const START = 8 * W + 2, GOAL = 8 * W + 21;

let seed = 7;
const next = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536); };

function makeGrid() {
  const cost = []; // cost[cell] = minutes to enter the cell, or 0 for a wall
  for (let i = 0; i < W * H; i++) cost.push(next() % 8 === 0 ? 0 : MIN_COST + (next() % 2));
  cost[START] = MIN_COST; cost[GOAL] = MIN_COST; // start and goal are always open
  return cost;
}

// A binary heap ordered by (priority, cell), so ties are broken the same way in every language.
class Heap {
  constructor() { this.a = []; }
  less(i, j) { const x = this.a[i], y = this.a[j]; return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]); }
  push(p, c) {
    this.a.push([p, c]);
    for (let i = this.a.length - 1; i > 0;) { const up = (i - 1) >> 1; if (!this.less(i, up)) break; [this.a[i], this.a[up]] = [this.a[up], this.a[i]]; i = up; }
  }
  pop() {
    const top = this.a[0], last = this.a.pop();
    if (this.a.length) {
      this.a[0] = last;
      for (let i = 0;;) {
        let m = i; const l = 2 * i + 1, r = l + 1;
        if (l < this.a.length && this.less(l, m)) m = l;
        if (r < this.a.length && this.less(r, m)) m = r;
        if (m === i) break;
        [this.a[i], this.a[m]] = [this.a[m], this.a[i]]; i = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

// With heuristic off this is Dijkstra. With it on, the straight-line (block) distance times the cheapest cell cost never overestimates, so the answer stays exact.
function route(cost, start, goal, useEstimate) {
  const gx = goal % W, gy = Math.floor(goal / W);
  const estimate = (c) => (useEstimate ? (Math.abs((c % W) - gx) + Math.abs(Math.floor(c / W) - gy)) * MIN_COST : 0);
  const best = new Array(W * H).fill(Infinity), prev = new Array(W * H).fill(-1), done = new Array(W * H).fill(false);
  const heap = new Heap(); best[start] = 0; heap.push(estimate(start), start);
  let settled = 0;
  while (heap.size) {
    const [, c] = heap.pop();
    if (done[c]) continue;
    done[c] = true; settled++;
    if (c === goal) break;
    const x = c % W, y = Math.floor(c / W);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (cost[n] === 0) continue;
      if (best[c] + cost[n] < best[n]) { best[n] = best[c] + cost[n]; prev[n] = c; heap.push(best[n] + estimate(n), n); }
    }
  }
  const path = []; for (let c = goal; c !== -1; c = prev[c]) path.push(c);
  return { cost: best[goal], settled, path: path.reverse() };
}

const pathCost = (cost, path) => path.slice(1).reduce((sum, c) => sum + cost[c], 0);
const open = (cost) => cost.filter((c) => c > 0).length;

function compare(label, cost) {
  const d = route(cost, START, GOAL, false), a = route(cost, START, GOAL, true);
  console.log(`${label}: Dijkstra cost ${d.cost}, settled ${d.settled} of ${open(cost)} cells`);
  console.log(`${label}: A* cost ${a.cost}, settled ${a.settled} (${Math.floor((100 * a.settled) / d.settled)}% of Dijkstra)`);
  const same = d.cost === a.cost && pathCost(cost, d.path) === d.cost && pathCost(cost, a.path) === a.cost;
  console.log(`${label}: same cost and both paths add up: ${same}`);
  if (!same || a.settled > d.settled || d.cost === Infinity) process.exit(1);
  return a;
}

const cost = makeGrid();
const before = compare('free-flowing', cost);

// A jam: every cell in the middle block takes three times as long. The estimate still never overestimates, so A* stays exact.
const jammed = cost.map((c, i) => (c > 0 && i % W >= 8 && i % W < 16 && Math.floor(i / W) >= 4 && Math.floor(i / W) < 12 ? c * 3 : c));
const after = compare('with a jam', jammed);
console.log(`the jam adds ${after.cost - before.cost} minutes to the trip`);
if (after.cost < before.cost) process.exit(1);
