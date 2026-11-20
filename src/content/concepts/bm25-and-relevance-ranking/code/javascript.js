// Ranking 8 tiny documents three ways: plain term count, TF-IDF, and BM25 (idf x saturating tf x length normalization).
// Scores are printed in hundredths (integers), so the output is the same in every language.
const DOCS = [
  'cheap laptop',
  'cheap laptop with a long battery life for travel and study',
  'laptop laptop cheap laptop laptop laptop best laptop laptop laptop deals laptop laptop laptop laptop laptop laptop shop', // keyword stuffing
  'the review tests the screen the keyboard the speakers and the fan noise of one laptop and notes that the battery lasts all day while the charger is heavy and the price is fair for the quality of the build',
  'battery packs for phones and tablets with fast charging',
  'the best laptop battery replacement guide',
  'desktop computers and monitors for the office',
  'a laptop stand for the desk',
];
const QUERY = 'cheap laptop battery';
const STUFFED = 3; // document number of the keyword-stuffed page

const tokens = DOCS.map((d) => d.split(' '));
const N = tokens.length;
const AVG_LEN = tokens.reduce((sum, t) => sum + t.length, 0) / N;
const countIn = (doc, word) => doc.filter((w) => w === word).length;
const docFreq = (word) => tokens.filter((t) => t.includes(word)).length;

// mode: 'count' | 'tfidf' | 'bm25'. k1 and b come in as integers (k1 x 10, b x 100) so no float is ever printed.
function rank(query, mode, k1x10 = 12, bx100 = 75) {
  const k1 = k1x10 / 10, b = bx100 / 100;
  const terms = query.split(' ');
  const scored = tokens.map((doc, i) => {
    let s = 0;
    for (const w of terms) {
      const tf = countIn(doc, w);
      if (tf === 0) continue;
      const df = docFreq(w);
      if (mode === 'count') s += tf;
      else if (mode === 'tfidf') s += tf * Math.log(1 + N / df);
      else s += Math.log(1 + (N - df + 0.5) / (df + 0.5)) * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc.length / AVG_LEN));
    }
    return { doc: i + 1, hundredths: mode === 'count' ? s : Math.floor(s * 100 + 0.5) };
  });
  return scored.sort((x, y) => y.hundredths - x.hundredths || x.doc - y.doc);
}
const top = (r, n) => r.slice(0, n).map((x) => `doc${x.doc}=${x.hundredths}`).join(' ');
const place = (r, doc) => r.findIndex((x) => x.doc === doc) + 1;

console.log(`${N} documents, ${tokens.reduce((sum, t) => sum + t.length, 0)} words, longest ${Math.max(...tokens.map((t) => t.length))} words, shortest ${Math.min(...tokens.map((t) => t.length))}`);
console.log(`query "${QUERY}" (count is in occurrences, the other scores in hundredths)`);
for (const [name, mode] of [['plain count', 'count'], ['tf-idf', 'tfidf'], ['bm25 k1=1.2 b=0.75', 'bm25']]) {
  const r = rank(QUERY, mode);
  console.log(`  ${name}: ${top(r, 4)}; keyword-stuffed doc${STUFFED} is number ${place(r, STUFFED)}`);
}
console.log('how one term saturates under BM25 (k1=1.2, average-length document), in hundredths of the term weight:');
console.log('  ' + [1, 2, 3, 10, 20].map((tf) => `tf${tf}=${Math.floor(tf * 2.2 / (tf + 1.2) * 100 + 0.5)}`).join(' '));
console.log('changing k1 (b=0.75):');
for (const k of [0, 12, 30]) console.log(`  k1=${k / 10}: ${top(rank(QUERY, 'bm25', k, 75), 3)}`);
console.log('changing b (k1=1.2):');
for (const b of [0, 75, 100]) console.log(`  b=${b / 100}: ${top(rank(QUERY, 'bm25', 12, b), 3)}`);
const check = rank(QUERY, 'bm25');
if (place(rank(QUERY, 'count'), STUFFED) !== 1 || place(check, STUFFED) <= 1) throw new Error('the stuffed page should win on counts and lose on BM25');
