// Product search for a store, four hours: how price and stock changes reach the search index, how the index is
// sharded, and how results are ranked. 2,000 sample listings stand for a catalog of 50 million (each sample listing
// is 25,000 real ones), so counts of changes are scaled up while shares and ranks are measured on the sample.
// Every rate and cost below is an assumption of the model, not a measurement. Everything is an integer, so the output never changes.
const END_MIN = 240, FROM_MIN = 60;          // minutes simulated; shoppers are measured from minute 60 on
const N = 2000, SCALE = 25000;               // sample listings, and real listings each one stands for
const QUERIES_PER_MIN = 30, CAND = 40, TOP = 10; // sample searches a minute, candidates per search, results shown
const PRICE_PPM = 2400, COUNT_PPM = 3000, OUT_PPM = 1000, BACK_PPM = 10000; // per listing per minute, parts per million; busy listings change more
const STORM_FROM = 120, STORM_TO = 180, STORM_X = 3; // a flash sale reprices items three times as often
const NEW_PER_MIN = 6000;                    // new listings and text edits a minute, in the real catalog
const DOCS_PER_SHARD = 1400;                 // whole documents one shard copy can write a second, at a long refresh interval
const INDEX_S = 1, SIDE_S = 1;               // seconds to analyse and write a document; to write the side store
const QPS = 20000, CORES = 32;               // searches a second at peak; cores in each search node
const W_US = 8000, F_US = 1000, FETCH_US = 3000, SIDE_US = 4000; // microseconds: whole-index work, fixed work per shard, merge and fetch, side lookup
const SALES_CAP = 30, NEW_BOOST = 25;        // the tuned mix: sales can add at most 30 points, a new listing gets 25
const IDX_SHARE = 50;                        // share of a node's CPU that indexing may take
const TAIL = { 4: 599, 8: 668, 16: 738, 32: 807 }; // ln(100 x shards) x 100: the 99th percentile of the slowest of n shards
const DISC = [1000, 631, 500, 431, 387, 356, 333, 315, 301, 289]; // 1000 / log2(position + 1)

let seed;
const rnd = (n) => { seed = (seed * 48271) % 2147483647; return seed % n; };
const cube = (x) => Math.floor((x * x * x) / 10000000); // 0 to 99, most listings near 0: a few best sellers

function catalog() {
  seed = 11;
  const sales = [], oos = [];
  for (let i = 0; i < N; i++) { const x = rnd(1000); sales.push(i % 10 === 3 ? 0 : cube(x)); } // every tenth listing is new, with no sales yet
  for (let i = 0; i < N; i++) oos.push(rnd(100) < 2 + Math.floor(sales[i] / 5));
  return { sales, oos };
}

// The stream of changes to the sample listings: price changes, stock counts going down, sell-outs and restocks.
function changes(cat, storm) {
  seed = 23;
  const oos = cat.oos.slice(), ev = [], perMin = new Array(END_MIN).fill(0);
  for (let m = 0; m < END_MIN; m++) {
    const x = storm && m >= STORM_FROM && m < STORM_TO ? STORM_X : 1;
    for (let i = 0; i < N; i++) {
      const r = rnd(1000000), w = 10 + cat.sales[i];
      const price = Math.floor((PRICE_PPM * w * x) / 35), count = Math.floor((COUNT_PPM * w) / 35), out = Math.floor((OUT_PPM * w) / 35);
      let kind = '';
      if (oos[i]) { if (r < BACK_PPM) kind = 'back'; else if (r < BACK_PPM + price) kind = 'price'; }
      else if (r < price) kind = 'price';
      else if (r < price + count) kind = 'count';
      else if (r < price + count + out) kind = 'out';
      if (!kind) continue;
      if (kind === 'out') oos[i] = true;
      if (kind === 'back') oos[i] = false;
      ev.push({ m, te: m * 60 + rnd(59), i, kind, ve: 0, n: ev.length });
      perMin[m]++;
    }
  }
  return { ev, perMin };
}

// The judged set: 12 broad "head" queries and 12 specific "tail" ones, 30 candidates each, graded 0 to 3.
// Head queries: many listings match about equally, and what shoppers buy is a good signal. Tail queries: a few
// listings match exactly (two of them brand new) and some best sellers match only loosely.
function judged() {
  seed = 4242;
  const set = [];
  for (let q = 0; q < 24; q++) {
    const head = q < 12, cands = [];
    for (let j = 0; j < 30; j++) {
      const fresh = head ? j % 15 === 7 : j === 1 || j === 2;
      let s = fresh ? 0 : cube(rnd(1000)), t, g;
      if (head) {
        t = 60 + rnd(36);
        const quality = t + Math.floor(s / 2) + rnd(21) - 10;
        g = quality >= 115 ? 3 : quality >= 100 ? 2 : quality >= 85 ? 1 : 0;
      } else {
        t = j < 3 ? 85 + rnd(16) : j < 9 ? 40 + rnd(21) : 20 + rnd(51);
        if (j >= 3 && j < 9) s = 80 + rnd(20);
        g = t >= 85 ? 3 : t >= 70 ? 2 : t >= 50 ? 1 : 0;
      }
      cands.push({ t, s, g, fresh, oos: rnd(100) < 2 + Math.floor(s / 5) });
    }
    set.push({ head, cands });
  }
  return set;
}

// The score a ranking mix gives a listing from its text score t, its sales score s and whether it is new.
const key = (mix, t, s, fresh) => (mix === 'text' ? t : mix === 'tuned' ? 2 * t + Math.min(s, SALES_CAP) + (fresh ? NEW_BOOST : 0) : 2 * t + s);

function relevance(mix) {
  let head = 0, tail = 0;
  for (const { head: isHead, cands } of judged()) {
    const gain = (c) => (c.oos ? 0 : (1 << c.g) - 1); // a result nobody can buy earns nothing
    const dcg = (list) => list.slice(0, TOP).reduce((a, c, p) => a + gain(c) * DISC[p], 0);
    const pool = mix !== 'text' && mix !== 'sales' ? cands.filter((c) => !c.oos) : cands;
    const ranked = pool.map((c, k) => ({ c, k })).sort((a, b) => key(mix, b.c.t, b.c.s, b.c.fresh) - key(mix, a.c.t, a.c.s, a.c.fresh) || a.k - b.k).map((x) => x.c);
    const ideal = cands.slice().sort((a, b) => gain(b) - gain(a));
    const score = Math.floor((dcg(ranked) * 100) / Math.max(1, dcg(ideal)));
    if (isHead) head += score; else tail += score;
  }
  return { head: Math.floor(head / 12), tail: Math.floor(tail / 12), all: Math.floor((head + tail) / 24) };
}

const tenths = (n) => `${Math.floor(n / 10)}.${n % 10}`;

function run(name, { path, refresh, shards, replicas, mix, storm }) {
  const cat = catalog(), { ev, perMin } = changes(cat, storm);
  const copies = 1 + replicas;
  const cap = Math.floor((shards * DOCS_PER_SHARD * (refresh + 3)) / (refresh + 6)); // whole documents a second the shards can write, one copy each
  const busy = new Array(END_MIN).fill(0), done = new Array(END_MIN).fill(0), lag = new Array(END_MIN).fill(0);
  const batches = [];
  if (path === 'batch') {
    // every hour all listings changed since the last export are re-indexed in one go, and the new index opens when that ends
    let prevEnd = 0, exported = -1;
    for (let k = 1; k <= 4; k++) {
      const start = Math.max(3600 * k, prevEnd), dirty = new Set();
      for (const e of ev) if (e.te > exported && e.te <= start) dirty.add(e.i);
      const total = dirty.size * SCALE + NEW_PER_MIN * 60, end = start + Math.ceil(total / cap);
      for (const e of ev) if (e.te > exported && e.te <= start) e.ve = end;
      batches.push({ start, end });
      exported = start; prevEnd = end;
    }
    for (let m = 0; m < END_MIN; m++) {
      let secs = 0;
      for (const b of batches) secs += Math.max(0, Math.min(b.end, m * 60 + 60) - Math.max(b.start, m * 60));
      busy[m] = Math.floor((secs * 100) / 60); done[m] = secs * cap;
    }
  } else {
    // a queue in front of the indexer: changes wait when they arrive faster than the shards can write
    let backlog = 0;
    const arrivals = perMin.map((n) => (path === 'nrt' ? n * SCALE : 0) + NEW_PER_MIN), room = cap * 60, raw = [];
    for (let m = 0; m < END_MIN; m++) {
      const take = Math.min(backlog + arrivals[m], room);
      raw.push(Math.min(100, Math.floor(((backlog + arrivals[m]) * 100) / room)));
      let sum = 0; // searches feel indexing over minutes, not seconds: the load is the average of the last ten minutes
      for (let k = Math.max(0, m - 9); k <= m; k++) sum += raw[k];
      busy[m] = Math.floor(sum / (m - Math.max(0, m - 9) + 1));
      done[m] = take; backlog = backlog + arrivals[m] - take; lag[m] = Math.ceil(backlog / cap);
    }
    const last = new Array(N).fill(0); // one listing's changes stay in order
    for (const e of ev) {
      let ve = path === 'side' ? e.te + SIDE_S : Math.ceil((e.te + INDEX_S + lag[e.m]) / refresh) * refresh;
      ve = Math.max(ve, last[e.i]); last[e.i] = ve; e.ve = ve;
    }
  }
  // how long a new listing takes to become searchable (60 listings created through the window); new listings always go through the index
  let waited = 0;
  for (let k = 0; k < 60; k++) {
    const te = 3600 + k * 170 + ((k * 37) % 60), m = Math.floor(te / 60);
    const ve = path === 'batch' ? batches.find((b) => b.start >= te).end : Math.ceil((te + INDEX_S + lag[m]) / refresh) * refresh;
    waited += ve - te;
  }
  // the shoppers: what they see against what is true at the end of each minute
  const truth = cat.oos.slice(), view = cat.oos.slice(), priceVe = new Array(N).fill(0), pend = [];
  let shown = 0, badPrice = 0, badStock = 0, badAny = 0, at = 0;
  const perm = Array.from({ length: N }, (_, i) => i);
  seed = 99;
  for (let m = 0; m < END_MIN; m++) {
    for (; at < ev.length && ev[at].m === m; at++) {
      const e = ev[at];
      if (e.kind === 'out') truth[e.i] = true;
      if (e.kind === 'back') truth[e.i] = false;
      if (e.kind === 'price') priceVe[e.i] = e.ve;
      if (e.kind === 'out' || e.kind === 'back') pend.push(e);
    }
    const tq = m * 60 + 59;
    pend.sort((a, b) => a.ve - b.ve || a.n - b.n);
    while (pend.length && pend[0].ve <= tq) { const e = pend.shift(); view[e.i] = e.kind === 'out'; }
    if (m < FROM_MIN) continue;
    for (let q = 0; q < QUERIES_PER_MIN; q++) {
      const list = [];
      for (let j = 0; j < CAND; j++) { const k = j + rnd(N - j); [perm[j], perm[k]] = [perm[k], perm[j]]; list.push({ i: perm[j], t: rnd(100), j }); }
      const pool = mix !== 'text' && mix !== 'sales' ? list.filter((c) => !view[c.i]) : list; // the filter trusts what the index (or side store) says
      pool.sort((a, b) => key(mix, b.t, cat.sales[b.i], b.i % 10 === 3) - key(mix, a.t, cat.sales[a.i], a.i % 10 === 3) || a.j - b.j);
      for (const c of pool.slice(0, TOP)) {
        const stale = priceVe[c.i] > tq, gone = truth[c.i];
        shown++; if (stale) badPrice++; if (gone) badStock++; if (stale || gone) badAny++;
      }
    }
  }
  // the slowest minute for searches, and how many documents the shards re-index
  let worst = 0, peakDocs = 0, sumDocs = 0;
  const sUs = Math.floor(((Math.floor(W_US / shards) + F_US) * (100 + Math.floor(40 / refresh))) / 100);
  for (let m = FROM_MIN; m < END_MIN; m++) {
    const rho = Math.min(98, Math.floor((QPS * sUs * 100) / (1000000 * copies * CORES)) + Math.floor((IDX_SHARE * busy[m]) / 100));
    const mean = sUs + Math.floor((sUs * rho * rho) / (100 * (100 - rho)));
    const p99 = Math.floor((mean * TAIL[shards]) / 100) + FETCH_US + (path === 'side' ? SIDE_US : 0);
    worst = Math.max(worst, p99);
    peakDocs = Math.max(peakDocs, Math.floor(done[m] / 60)); sumDocs += done[m];
  }
  const rel = relevance(mix);
  console.log(`-- ${name}`);
  console.log(`  results showing a stale price or no stock: ${tenths(Math.floor((badAny * 1000) / shown))}% (stale price ${tenths(Math.floor((badPrice * 1000) / shown))}%, out of stock ${tenths(Math.floor((badStock * 1000) / shown))}%) of ${shown}`);
  console.log(`  slowest minute p99 ${Math.floor(worst / 1000)} ms; documents re-indexed per second: peak ${peakDocs * copies}, average ${Math.floor((sumDocs * copies) / ((END_MIN - FROM_MIN) * 60))}, capacity ${cap * copies}; index behind by ${path === 'batch' ? 'up to an hour' : `${lag[END_MIN - 1]} s`} at the end`);
  console.log(`  new listing searchable after ${Math.floor(waited / 60)} s; relevance ${rel.all} (head ${rel.head}, tail ${rel.tail})`);
}

const base = { path: 'batch', refresh: 5, shards: 8, replicas: 2, mix: 'text', storm: false };
run('hourly batch', base);
run('near real time, all fields', { ...base, path: 'nrt' });
run('near real time, all fields, 1 s refresh, flash sale', { ...base, path: 'nrt', refresh: 1, storm: true });
run('near real time, price and stock on the side', { ...base, path: 'side', refresh: 1, storm: true });
run('side lookups, text and sales', { ...base, path: 'side', mix: 'sales' });
run('side lookups, text, sales and stock filter', { ...base, path: 'side', mix: 'stock' });
run('hourly batch, text, sales and stock filter', { ...base, mix: 'stock' });
run('side lookups, capped sales, new boost and stock filter', { ...base, path: 'side', mix: 'tuned' });
