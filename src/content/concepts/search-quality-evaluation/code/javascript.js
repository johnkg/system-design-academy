// Judging two rankers offline: a judged set (query, document, grade 0 to 3), precision@k, recall@k and NDCG@k per query,
// and an average that depends on which queries you count and how much each one weighs. Scores print in hundredths (integers).
// grades: judged documents of the query; a, b: the ranked lists the two rankers returned; weight: share of real traffic (percent).
const QUERIES = [
  { text: 'iphone case', head: true, weight: 40, grades: { d1: 3, d2: 3, d3: 2, d4: 2, d5: 1, d6: 1, d7: 0, d8: 0 },
    a: ['d1', 'd2', 'd3', 'd7', 'd4'], b: ['d1', 'd3', 'd7', 'd8', 'd2'] },
  { text: 'laptop', head: true, weight: 25, grades: { d1: 3, d2: 2, d3: 2, d4: 1, d5: 1, d6: 0, d7: 0 },
    a: ['d1', 'd2', 'd3', 'd4', 'd6'], b: ['d2', 'd6', 'd1', 'd7', 'd3'] },
  { text: 'headphones', head: true, weight: 15, grades: { d1: 3, d2: 3, d3: 2, d4: 1, d5: 0, d6: 0, d7: 0 },
    a: ['d1', 'd2', 'd5', 'd3', 'd4'], b: ['d5', 'd2', 'd6', 'd1', 'd7'] },
  { text: 'waterproof case for iphone 12 mini', head: false, weight: 7, grades: { d1: 3, d2: 2, d3: 2, d4: 1, d5: 0, d6: 0, d7: 0 },
    a: ['d5', 'd6', 'd4', 'd7', 'd1'], b: ['d2', 'd5', 'd6', 'd1', 'd4'] },
  { text: 'quiet mechanical keyboard office', head: false, weight: 7, grades: { d1: 3, d2: 3, d3: 1, d4: 1, d5: 0, d6: 0 },
    a: ['d3', 'd5', 'd1', 'd6', 'd4'], b: ['d3', 'd5', 'd6', 'd1', 'd4'] },
  { text: 'gift for dad who likes coffee', head: false, weight: 6, grades: { d1: 3, d2: 2, d3: 2, d4: 1, d5: 0, d6: 0, d7: 0, d8: 0, d9: 0 },
    a: ['d5', 'd6', 'd7', 'd8', 'd9'], b: ['d1', 'd2', 'd3', 'd4', 'd5'] },
];
const hundredths = (x) => Math.floor(x * 100 + 0.5);
const gain = (g) => 2 ** g - 1;
const dcg = (grades) => grades.reduce((s, g, i) => s + gain(g) / Math.log2(i + 2), 0);

// A document counts as relevant when its grade is 1 or more.
function metrics(q, ranking, k) {
  const got = ranking.slice(0, k).map((d) => q.grades[d] ?? 0);
  const relevantTotal = Object.values(q.grades).filter((g) => g > 0).length;
  const hits = got.filter((g) => g > 0).length;
  const ideal = Object.values(q.grades).sort((x, y) => y - x).slice(0, k);
  return { p: hundredths(hits / k), r: hundredths(hits / relevantTotal), ndcg: hundredths(dcg(got) / dcg(ideal)) };
}
// Weighted average of per-query hundredths, rounded to the nearest hundredth with integer arithmetic only.
const average = (values, weights) => { const w = weights.reduce((s, x) => s + x, 0); return Math.floor((2 * values.reduce((s, v, i) => s + v * weights[i], 0) + w) / (2 * w)); };

const per = (k) => QUERIES.map((q) => ({ a: metrics(q, q.a, k), b: metrics(q, q.b, k) }));
console.log('per query at k = 3 and 5 (hundredths): A | B');
for (const [i, q] of QUERIES.entries()) {
  const m3 = per(3)[i], m5 = per(5)[i];
  console.log(`  ${q.head ? 'head' : 'tail'} "${q.text}": precision@3 ${m3.a.p} | ${m3.b.p}, recall@5 ${m5.a.r} | ${m5.b.r}, NDCG@5 ${m5.a.ndcg} | ${m5.b.ndcg}`);
}
const m5 = per(5);
const mixes = [
  ['every query counts the same', QUERIES.map(() => 1)],
  ['weighted by traffic', QUERIES.map((q) => q.weight)],
  ['head queries only', QUERIES.map((q) => (q.head ? q.weight : 0))],
  ['tail queries only', QUERIES.map((q) => (q.head ? 0 : q.weight))],
];
console.log('average NDCG@5 under each query mix: A | B -> winner');
const winners = {};
for (const [name, w] of mixes) {
  const a = average(m5.map((m) => m.a.ndcg), w), b = average(m5.map((m) => m.b.ndcg), w);
  winners[name] = a === b ? 'tie' : a > b ? 'A' : 'B';
  console.log(`  ${name}: ${a} | ${b} -> ${winners[name]}`);
}
let aWins = 0, bWins = 0;
for (const m of m5) { if (m.a.ndcg > m.b.ndcg) aWins++; else if (m.b.ndcg > m.a.ndcg) bWins++; }
console.log(`per query NDCG@5: A better on ${aWins}, B better on ${bWins}`);
console.log('one query swings the average (every query counts the same):');
const equal = QUERIES.map(() => 1);
for (const drop of [-1, 5]) {
  const w = equal.map((x, i) => (i === drop ? 0 : x));
  const a = average(m5.map((m) => m.a.ndcg), w), b = average(m5.map((m) => m.b.ndcg), w);
  console.log(`  ${drop < 0 ? 'all 6 queries' : `without "${QUERIES[drop].text}"`}: ${a} | ${b} -> ${a > b ? 'A' : 'B'}`);
}
if (winners['weighted by traffic'] === winners['tail queries only']) throw new Error('the query mix should flip the winner');
