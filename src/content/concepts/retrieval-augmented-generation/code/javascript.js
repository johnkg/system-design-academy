// A tiny RAG retriever in JavaScript: chunk, score with term overlap weighted by idf, optionally rerank, pack into a token budget.
// No embeddings: the scorer is lexical, which is enough to show where chunk size, top-k and the budget change the answer.

const DOCS = {
  returns: "Returns policy. Customers may return unused accessories such as cables and cases within 14 days of delivery. Opened software cannot be refunded. Refunds go back to the original payment method within 5 business days. Returns of laptops are accepted within 30 days of delivery if the device works and all original packaging is included. Gift purchases can be returned for store credit only.",
  shipping: "Shipping and delivery. Standard delivery takes 3 to 5 days and express delivery takes 1 to 2 days. A laptop ships in a padded box and needs a signature on delivery. After delivery you can track the parcel for 30 days. Delivery to islands can take 10 days.",
  warranty: "Laptop warranty. The warranty covers defects for 12 months after delivery. To claim, send the laptop back to a service centre with the order number. We repair or replace the laptop within 21 days. Damage from liquids is not covered.",
  payments: "Payments. We accept cards and bank transfer. Invoices are due in 30 days. A failed payment is retried twice before the order is cancelled.",
};
const ANSWER = "laptops are accepted within 30 days of delivery";
const STOP = new Set("how can i a an the of to is are in on and or for after you your with by it".split(" "));

const words = (t) => t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(" ").filter(Boolean);
const stem = (w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
const bitLength = (x) => { let n = 0; for (; x > 0; x = Math.floor(x / 2)) n++; return n; };
// integer idf in half-octave steps: rarer terms weigh more, and every language computes the same number
const idfOf = (n, df) => { const x = Math.floor((4096 * n) / df), b = bitLength(x) - 1; return 2 * b + (b >= 1 ? Math.floor(x / 2 ** (b - 1)) % 2 : 0); };
const tokensOf = (wordCount) => Math.floor((wordCount * 13 + 9) / 10) + 6; // about 1.3 tokens per word plus a citation header

function chunk(size, overlap) {
  const out = [];
  if (overlap >= size) throw new Error("overlap must be smaller than the chunk size");
  for (const [doc, text] of Object.entries(DOCS)) {
    const w = words(text);
    for (let s = 0, n = 0; ; s += size - overlap, n++) {
      out.push({ id: `${doc}#${n}`, doc, words: w.slice(s, s + size) });
      if (s + size >= w.length) break;
    }
  }
  return out;
}

function retrieve(query, { size, overlap, k, rerank, budget }) {
  const chunks = chunk(size, overlap);
  const terms = [...new Set(words(query).filter((w) => !STOP.has(w)).map(stem))];
  const idf = {};
  for (const t of terms) {
    const df = chunks.filter((c) => c.words.map(stem).includes(t)).length;
    if (df) idf[t] = idfOf(chunks.length, df);
  }
  for (const c of chunks) {
    const stems = c.words.map(stem);
    c.score = 0;
    for (const t of terms) { const tf = stems.filter((x) => x === t).length; c.score += (idf[t] ?? 0) * Math.min(tf, 2); }
  }
  const order = (a, b) => b.score - a.score || (a.id < b.id ? -1 : 1);
  let ranked = chunks.filter((c) => c.score > 0).sort(order);
  if (rerank) { // second stage on the 8 best candidates: reward a dense 12 word window instead of scattered matches
    ranked = ranked.slice(0, 8);
    for (const c of ranked) {
      const stems = c.words.map(stem);
      let best = 0;
      for (let s = 0; s < stems.length; s++) best = Math.max(best, terms.filter((t) => stems.slice(s, s + 12).includes(t)).reduce((a, t) => a + (idf[t] ?? 0), 0));
      c.score = best * 4 + Math.floor(c.score / 4);
    }
    ranked.sort(order);
  }
  const context = []; let used = 0;
  for (const c of ranked.slice(0, k)) { // greedy packing: stop adding chunks that do not fit
    const cost = tokensOf(c.words.length);
    if (used + cost <= budget) { context.push(c); used += cost; }
  }
  return { chunks: chunks.length, top: ranked.slice(0, k), context, used };
}

const answerStems = words(ANSWER).map(stem);
const hasAnswer = (c) => { const s = c.words.map(stem); return s.some((_, i) => answerStems.every((w, j) => s[i + j] === w)); };

const Q = "how long can I send back a laptop after delivery";
const configs = [ // name, options, whether the full answer sentence must reach the prompt
  ["30 words, no overlap, k=3", { size: 30, overlap: 0, k: 3, rerank: false, budget: 300 }, false],
  ["30 words, overlap 10, k=3", { size: 30, overlap: 10, k: 3, rerank: false, budget: 300 }, true],
  ["20 words, overlap 10, k=5", { size: 20, overlap: 10, k: 5, rerank: false, budget: 300 }, false],
  ["same + rerank", { size: 20, overlap: 10, k: 5, rerank: true, budget: 300 }, true],
  ["60 words, k=3, budget 60", { size: 60, overlap: 0, k: 3, rerank: false, budget: 60 }, false],
];
for (const [name, o, expected] of configs) {
  const r = retrieve(Q, o);
  const hit = r.context.some(hasAnswer);
  console.log(`${name}: ${r.chunks} chunks, top ${r.top.map((c) => `${c.id}=${c.score}`).join(" ")}`);
  console.log(`  context ${r.used}/${o.budget} tokens, answer sentence intact: ${hit}`);
  if (hit !== expected || r.used > o.budget || o.overlap >= o.size) process.exit(1);
}
