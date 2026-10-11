// A tiny recommender in JavaScript: popularity, item-to-item co-occurrence, and diversity re-ranking,
// judged on one held-out interaction per user. Cold-start users fall back to popularity, and new items get an exploration slot.
const USERS = 120, GENRES = 6, PER = 8, ITEMS = GENRES * PER, K = 5, NEW_ITEM = ITEMS; // item 48 is new and has no interactions
const genreOf = (item) => Math.floor(item / PER);

let seed = 7;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

// Each user mostly likes one genre (user % 6); within a genre, the low item numbers are the popular ones.
const history = [], heldOut = [];
for (let u = 0; u < USERS; u++) {
  const seen = [];
  while (seen.length < 12) {
    const g = random(10) < 8 ? u % GENRES : random(GENRES);
    const item = g * PER + Math.min(random(PER), random(PER));
    if (!seen.includes(item)) seen.push(item);
  }
  heldOut.push(seen.pop()); // the last interaction is hidden from training and used as the test
  history.push(seen);
}

// "Training": count how popular each item is, and how often two items were liked by the same user.
const pop = new Array(ITEMS + 1).fill(0);
const co = Array.from({ length: ITEMS + 1 }, () => new Array(ITEMS + 1).fill(0));
for (const items of history) for (const a of items) { pop[a]++; for (const b of items) if (a !== b) co[a][b]++; }
const popularity = Array.from({ length: ITEMS + 1 }, (_, i) => i).sort((a, b) => pop[b] - pop[a] || a - b);

const similarity = (a, b) => (pop[a] === 0 || pop[b] === 0 ? 0 : co[a][b] / Math.sqrt(pop[a] * pop[b]));
const unseen = (items) => Array.from({ length: ITEMS + 1 }, (_, i) => i).filter((i) => !items.includes(i));

function byPopularity(items) { return popularity.filter((i) => !items.includes(i)).slice(0, K); }

// Candidates are ranked by their summed similarity to what the user already liked. A user with no history has no signal, so use popularity.
function ranked(items) {
  const scored = unseen(items).map((c) => ({ c, s: items.reduce((sum, h) => sum + similarity(h, c), 0) }));
  return scored.sort((x, y) => y.s - x.s || x.c - y.c);
}
function byCf(items) { return items.length === 0 ? byPopularity(items) : ranked(items).slice(0, K).map((x) => x.c); }

// Greedy re-rank of the best 15: each pick divides the score of items of the same genre by 1 + (how many of that genre are already picked).
function diverse(items) {
  if (items.length === 0) return byPopularity(items);
  const pool = ranked(items).slice(0, 15), picked = [];
  while (picked.length < K) {
    let best = null, bestScore = -1;
    for (const x of pool) {
      if (picked.includes(x.c)) continue;
      const adj = x.s / (1 + picked.filter((p) => genreOf(p) === genreOf(x.c)).length);
      if (adj > bestScore) { best = x.c; bestScore = adj; }
    }
    picked.push(best);
  }
  return picked;
}

// Exploration slot: for every 10th user the last slot shows the new item, so that it can start collecting interactions.
const withExplore = (list, u) => (u % 10 === 0 ? [...list.slice(0, K - 1), NEW_ITEM] : list);

function evaluate(name, recommend) {
  let hits = 0, newShown = 0; const covered = new Set(); let genreSum = 0;
  for (let u = 0; u < USERS; u++) {
    const list = recommend(history[u], u);
    if (list.includes(heldOut[u])) hits++;
    if (list.includes(NEW_ITEM)) newShown++;
    list.forEach((i) => covered.add(i));
    genreSum += new Set(list.map(genreOf)).size;
  }
  console.log(`${name.padEnd(18)} hits ${hits}/${USERS}, items shown ${covered.size}/${ITEMS + 1}, genres per list ${(genreSum / USERS).toFixed(2)}, new item shown ${newShown}`);
  return { hits, shown: covered.size, genres: genreSum / USERS, newShown };
}

const a = evaluate('popularity', byPopularity);
const b = evaluate('item-to-item CF', byCf);
const c = evaluate('CF + diversity', diverse);
const d = evaluate('CF + explore slot', (items, u) => withExplore(diverse(items), u));
const cold = diverse([]);
console.log(`cold-start user gets the popular items: ${cold.join(', ')}`);

const ok = b.hits > a.hits && b.shown > a.shown && c.genres > b.genres && c.shown >= b.shown && b.newShown === 0 && d.newShown === 12
  && JSON.stringify(cold) === JSON.stringify(popularity.slice(0, K));
console.log(`CF beats popularity, diversity widens lists, new item only via exploration: ${ok}`);
if (!ok) process.exit(1);
