// Inverted index: tokenise documents, map each term to a sorted postings list, merge lists for AND/OR, rank with TF-IDF.
const DOCS = [
  "Red apple pie recipe",
  "Green apple juice and red apple cider",
  "Apple pie with cream",
  "Red wine, red grapes and red jam",
  "Grape juice recipe",
  "Pie crust recipe with butter",
];
const STOP_WORDS = new Set(["and", "with", "the", "a", "of"]);
const MIN_LENGTH_FOR_PLURAL = 4; // "grapes" loses its s, "is" and "us" keep it
const TOP_RESULTS = 3;
const SCORE_DECIMALS = 3;
const SEGMENT_SPLIT = 3; // documents 0..2 go to segment A, the rest to segment B

// Lowercase, split on anything that is not a letter, drop stop words, strip a plural s.
function tokenize(text) {
  return text.toLowerCase().split(/[^a-z]+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .map((w) => (w.length >= MIN_LENGTH_FOR_PLURAL && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

// term -> postings list of [docId, termFrequency], always sorted by docId because we add documents in order.
function buildIndex(docs, firstId) {
  const index = new Map();
  docs.forEach((text, i) => {
    const counts = new Map();
    for (const t of tokenize(text)) counts.set(t, (counts.get(t) || 0) + 1);
    for (const [t, tf] of counts) {
      if (!index.has(t)) index.set(t, []);
      index.get(t).push([firstId + i, tf]);
    }
  });
  return index;
}

// Merge two segments: for each term, join the postings lists (segment B's ids are all larger, so order is kept).
function mergeSegments(a, b) {
  const merged = new Map(a);
  for (const [t, list] of b) merged.set(t, (merged.get(t) || []).concat(list));
  return merged;
}

// Two sorted id lists walked with one pointer each: no sorting, no nested loop.
function intersect(a, b) {
  const out = []; let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push(a[i]); i++; j++; }
    else if (a[i] < b[j]) i++; else j++;
  }
  return out;
}
function union(a, b) {
  const out = []; let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (j >= b.length || (i < a.length && a[i] < b[j])) out.push(a[i++]);
    else if (i >= a.length || b[j] < a[i]) out.push(b[j++]);
    else { out.push(a[i]); i++; j++; }
  }
  return out;
}

const index = buildIndex(DOCS, 0);
const ids = (term) => (index.get(term) || []).map((p) => p[0]);
const show = (list) => (list.length ? list.join(" ") : "none");

console.log(`docs: ${DOCS.length}, distinct terms: ${index.size}`);
for (const term of ["apple", "juice", "pie", "red"]) {
  console.log(`${term} -> ${index.get(term).map(([d, tf]) => `${d}:${tf}`).join(" ")}`);
}
console.log(`AND apple pie -> ${show(intersect(ids("apple"), ids("pie")))}`);
console.log(`OR juice grape -> ${show(union(ids("juice"), ids("grape")))}`);

// Rare terms matter more: idf = ln(1 + N / df). Score of a document = sum of tf * idf over the query terms.
function search(query, k) {
  const scores = new Map();
  for (const term of new Set(tokenize(query))) {
    const postings = index.get(term) || [];
    const idf = Math.log(1 + DOCS.length / postings.length);
    for (const [d, tf] of postings) scores.set(d, (scores.get(d) || 0) + tf * idf);
  }
  return [...scores].sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, k);
}
const query = "red apple juice";
console.log(`ranked: ${query}`);
for (const [d, score] of search(query, TOP_RESULTS)) {
  console.log(`  doc ${d} ${score.toFixed(SCORE_DECIMALS)} ${DOCS[d]}`);
}

// New documents go into a small new segment; merging segments gives the same index as building once.
const segA = buildIndex(DOCS.slice(0, SEGMENT_SPLIT), 0);
const segB = buildIndex(DOCS.slice(SEGMENT_SPLIT), SEGMENT_SPLIT);
const merged = mergeSegments(segA, segB);
const same = JSON.stringify([...merged].sort()) === JSON.stringify([...index].sort());
console.log(`segments: A has ${segA.size} terms, B has ${segB.size}, merged has ${merged.size}, same as one build: ${same ? "yes" : "no"}`);
