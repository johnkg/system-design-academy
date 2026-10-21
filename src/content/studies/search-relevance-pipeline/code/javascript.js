// Learning from clicks without being fooled by position, in JavaScript:
// the old ranking shows 8 products for one query, shoppers click more at the top, and we compare two ways to turn those clicks into a new order.

const relevance = [1, 0, 1, 3, 2, 0, 3, 1];          // judged grade of each product, 0 (bad) to 3 (perfect); the old ranking shows them in this order
const examine = [100, 60, 40, 30, 20, 15, 10, 8];     // percent of shoppers who even look at each position
const clickIfSeen = [2, 10, 30, 60];                  // percent who click a product they looked at, by its grade

const POSITIONS = relevance.length, SEED = 7;
const MIN_NDCG = 0.95; // the debiased order must come this close to the ideal one
let seed = SEED;
// Linear congruential generator (Numerical Recipes constants), high 16 bits.
const random = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor(seed / 65536) % n; };

// Log 40,000 searches. Every search shows the products in the old order, so product i is always at position i.
const searches = 40000;
const clicks = new Array(POSITIONS).fill(0);
for (let s = 0; s < searches; s++) {
  for (let pos = 0; pos < POSITIONS; pos++) {
    const looked = random(100) < examine[pos];
    if (looked && random(100) < clickIfSeen[relevance[pos]]) clicks[pos]++;
  }
}

// Naive: click-through rate per product. It mixes "good product" with "shown near the top".
const naive = clicks.map((c) => c / searches);
// Inverse propensity: a click at a position that few people look at counts for more (divide by the chance of being looked at).
const ips = clicks.map((c, pos) => c / searches / (examine[pos] / 100));

const orderBy = (score) => [...score.keys()].sort((a, b) => score[b] - score[a] || a - b);
const dcg = (order) => order.reduce((sum, item, pos) => sum + ((1 << relevance[item]) - 1) / Math.log2(pos + 2), 0);
const ideal = dcg(orderBy(relevance));
const ndcg = (order) => dcg(order) / ideal;

const oldOrder = [0, 1, 2, 3, 4, 5, 6, 7];
const naiveOrder = orderBy(naive);
const ipsOrder = orderBy(ips);
console.log(`clicks by position: ${clicks.join(' ')}`);
console.log(`old order   ${oldOrder.join('')}  NDCG ${ndcg(oldOrder).toFixed(3)}`);
console.log(`naive CTR   ${naiveOrder.join('')}  NDCG ${ndcg(naiveOrder).toFixed(3)}`);
console.log(`debiased    ${ipsOrder.join('')}  NDCG ${ndcg(ipsOrder).toFixed(3)}`);
const bestOrder = orderBy(relevance);
console.log(`ideal       ${bestOrder.join('')}  NDCG ${ndcg(bestOrder).toFixed(3)}`);

// The raw click rate puts a middling product on top just because it sat high; the debiased score finds both grade-3 products.
if (ndcg(ipsOrder) <= ndcg(naiveOrder) || ipsOrder[0] === 0 || ndcg(ipsOrder) < MIN_NDCG) process.exit(1);
