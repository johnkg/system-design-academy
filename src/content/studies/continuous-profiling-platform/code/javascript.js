// A tiny continuous-profiling backend, in JavaScript:
// samples of call stacks are interned by an FNV-1a hash, counted, folded into flame-graph paths and diffed across two releases.

// Rate control: the sampling frequency that keeps profiler overhead within a budget (in permille of one core).
// One second of one core is 1,000,000 microseconds, so a budget of b permille allows b * 1000 microseconds of sampling work per second.
const chooseHz = (budgetPermille, costUs) => Math.min(100, Math.floor((budgetPermille * 1000) / costUs));

const fnv1a = (text) => { // 32-bit FNV-1a over ASCII text
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
};

class Store {
  constructor() { this.stacks = new Map(); } // stack id -> frames (kept once, however many samples use it)
  intern(frames) {
    const id = fnv1a(frames.join(';'));
    const known = this.stacks.get(id);
    if (known && known.join(';') !== frames.join(';')) throw new Error('hash collision');
    if (!known) this.stacks.set(id, frames);
    return id;
  }
}

class Profile {
  constructor(store) { this.store = store; this.counts = new Map(); this.total = 0; } // stack id -> samples
  add(frames) { const id = this.store.intern(frames); this.counts.set(id, (this.counts.get(id) || 0) + 1); this.total++; }
  // A flame graph is the number of samples whose stack starts with each path.
  flame() {
    const paths = new Map();
    for (const [id, n] of this.counts) {
      const frames = this.store.stacks.get(id);
      for (let d = 1; d <= frames.length; d++) { const p = frames.slice(0, d).join(';'); paths.set(p, (paths.get(p) || 0) + n); }
    }
    return paths;
  }
}

// Weights of each call stack in two releases. The new release spends more time encoding JSON.
const mix = [
  ['main;handle;parse_json', 30, 30], ['main;handle;auth;verify_token', 20, 20], ['main;handle;render;json_encode', 15, 40],
  ['main;handle;db_query;wait', 25, 25], ['main;gc', 10, 10],
].map(([s, a, b]) => [s.split(';'), a, b]);

let seed = 7;
const next = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 16) % n; };
function collect(store, column, samples) {
  const profile = new Profile(store), total = mix.reduce((s, m) => s + m[column], 0);
  for (let i = 0; i < samples; i++) {
    let r = next(total), k = 0;
    while (r >= mix[k][column]) { r -= mix[k][column]; k++; }
    profile.add(mix[k][0]);
  }
  return profile;
}

console.log([100, 250, 1000].map((c) => `cost ${c}us -> ${chooseHz(10, c)} Hz`).join('; '));
const store = new Store();
const before = collect(store, 1, 20000), after = collect(store, 2, 20000);
console.log(`samples ${before.total + after.total}, distinct stacks ${store.stacks.size}`);

const flame = after.flame();
const byPath = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
console.log('flame graph of the new release:');
[...flame].sort((a, b) => b[1] - a[1] || byPath(a[0], b[0])).slice(0, 4).forEach(([p, n]) => console.log(`  ${n} ${p}`));

// Diff: compare shares in parts per 10,000, so two ranges with different sample counts can be compared.
const fa = before.flame(), diff = [];
for (const [p, n] of flame) diff.push([p, Math.floor((n * 10000) / after.total) - Math.floor(((fa.get(p) || 0) * 10000) / before.total)]);
diff.sort((a, b) => b[1] - a[1] || byPath(a[0], b[0]));
console.log('biggest share increases:');
diff.slice(0, 3).forEach(([p, d]) => console.log(`  +${d} ${p}`));

const rootOk = flame.get('main') === after.total && fa.get('main') === before.total;
const worst = diff.find(([p]) => p.endsWith('json_encode'));
console.log(`root equals samples: ${rootOk}; json_encode regression found: ${worst[1] > 1000}`);
if (!rootOk || worst[1] <= 1000 || chooseHz(10, 250) !== 40) process.exit(1);
