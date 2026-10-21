// A tiny search engine in JavaScript: analysis, an inverted index with positions, AND and phrase queries,
// BM25 ranking, and document-sharded scatter-gather whose merged answer must equal the answer of one big index.

const STOP = new Set(['the', 'of', 'a']);
const BASES = ['search', 'index', 'shard', 'rank', 'segment', 'term', 'token', 'filter', 'match', 'load'];
const SKIP = 8; // a skip pointer every 8 postings
const BM25_K1 = 1.2; // term-frequency saturation
const BM25_B = 0.75; // length normalisation
const MIN_DOC_WORDS = 8; // documents have 8..20 words
const DOC_WORDS_SPREAD = 13;
const STOPWORD_ONE_IN = 5;
const ZIPF_DIVISOR = 100000; // r^3 / ZIPF_DIVISOR maps 0..99 onto the 10 bases, favouring low ones
const DOCS = 600;
const RESULTS = 5; // hits per query
const SHOWN = 3; // top hits printed

// Analysis: split, lowercase, drop stop words (their positions are kept as gaps), strip a suffix.
function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1);
  return w;
}
const analyse = (text) => text.toLowerCase().split(' ').map((w, pos) => ({ w, pos })).filter((x) => !STOP.has(x.w)).map((x) => ({ term: stem(x.w), pos: x.pos }));

// Seeded generator, so every run builds the same corpus.
let state = 42;
const next = (n) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state >>> 16) % n; };
function makeDoc() {
  const words = [];
  for (let i = MIN_DOC_WORDS + next(DOC_WORDS_SPREAD); i > 0; i--) {
    if (next(STOPWORD_ONE_IN) === 0) { words.push(['the', 'of', 'a'][next(STOP.size)]); continue; }
    const r = next(100), base = BASES[Math.floor((r * r * r) / ZIPF_DIVISOR)]; // low-numbered words are much more common
    words.push(base + ['', /(x|ch)$/.test(base) ? 'es' : 's', 'ed', 'ing'][next(4)]);
  }
  return words.join(' ');
}
const docs = Array.from({ length: DOCS }, makeDoc);

class Index {
  constructor() { this.terms = new Map(); this.length = new Map(); }
  add(id, text) {
    const toks = analyse(text); this.length.set(id, text.split(' ').length);
    for (const { term, pos } of toks) {
      if (!this.terms.has(term)) this.terms.set(term, []);
      const list = this.terms.get(term);
      if (!list.length || list[list.length - 1].id !== id) list.push({ id, pos: [] });
      list[list.length - 1].pos.push(pos);
    }
  }
}

// First posting with id >= target, using skip pointers; cost counts every posting touched.
function advance(list, from, target, cost) {
  let i = from;
  while (i + SKIP < list.length && list[i + SKIP].id <= target) { i += SKIP; cost.n++; }
  while (i < list.length && list[i].id < target) { i++; cost.n++; }
  return i;
}
// AND of several terms; returns the matching [id, postings...] and counts postings read.
function intersect(index, terms, shortestFirst, cost) {
  let lists = terms.map((t) => index.terms.get(t) || []);
  if (shortestFirst) lists = [...lists].sort((a, b) => a.length - b.length);
  const ptr = lists.map(() => 0), out = [];
  for (const lead of lists[0]) {
    cost.n++; let ok = true;
    for (let k = 1; k < lists.length && ok; k++) { ptr[k] = advance(lists[k], ptr[k], lead.id, cost); ok = ptr[k] < lists[k].length && lists[k][ptr[k]].id === lead.id; }
    if (ok) out.push(lead.id);
  }
  return out;
}
const hasPhrase = (index, id, terms) => (index.terms.get(terms[0]).find((p) => p.id === id).pos).some((p0) => terms.every((t, k) => index.terms.get(t).find((p) => p.id === id).pos.includes(p0 + k)));

// BM25 with global statistics (N, document frequency, average length), so every shard scores on the same scale.
const stats = (index) => ({ n: index.length.size, avg: [...index.length.values()].reduce((a, b) => a + b, 0) / index.length.size });
function bm25(index, g, terms, id) {
  let score = 0;
  for (const t of terms) {
    const post = index.terms.get(t).find((p) => p.id === id), df = g.df.get(t), tf = post.pos.length;
    score += Math.log(1 + (g.n - df + 0.5) / (df + 0.5)) * (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * index.length.get(id) / g.avg));
  }
  return score;
}
function topK(index, g, terms, k) {
  const ids = intersect(index, terms, true, { n: 0 });
  return ids.map((id) => ({ id, score: bm25(index, g, terms, id) })).sort((a, b) => b.score - a.score || a.id - b.id).slice(0, k);
}

const whole = new Index(); docs.forEach((d, id) => whole.add(id, d));
const shards = [new Index(), new Index(), new Index()]; docs.forEach((d, id) => shards[id % shards.length].add(id, d));
const g = { ...stats(whole), df: new Map([...whole.terms].map(([t, l]) => [t, l.length])) };

const query = analyse('searching the matched tokens').map((t) => t.term);
console.log(`corpus: ${docs.length} documents, ${whole.terms.size} terms; query terms: ${query.join(' ')}`);
console.log(`posting list lengths: ${query.map((t) => `${t}=${whole.terms.get(t).length}`).join(' ')}`);
const inOrder = { n: 0 }, shortest = { n: 0 };
const a = intersect(whole, query, false, inOrder), b = intersect(whole, query, true, shortest);
console.log(`AND matches: ${a.length}; postings read in query order: ${inOrder.n}, shortest list first: ${shortest.n}`);
const phrase = a.filter((id) => hasPhrase(whole, id, query.slice(1)));
console.log(`phrase "${query.slice(1).join(' ')}" matches: ${phrase.length}`);

const single = topK(whole, g, query, RESULTS);
const merged = shards.flatMap((s) => topK(s, g, query, RESULTS)).sort((x, y) => y.score - x.score || x.id - y.id).slice(0, RESULTS);
for (const r of single.slice(0, SHOWN)) console.log(`doc ${r.id} score ${r.score.toFixed(4)}: ${docs[r.id]}`);
const same = JSON.stringify(single) === JSON.stringify(merged);
console.log(`3 shards merged equals one index: ${same}`);
if (!same || a.length !== b.length || shortest.n >= inOrder.n || phrase.length === 0) process.exit(1);
