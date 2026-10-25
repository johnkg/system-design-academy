// Budget pacing for one ad campaign across a day of bidding, simulated second by second, in JavaScript.
// Three designs spend the same daily budget: no pacing, a pacer that hands each bidder node a local slice, and a
// central counter that every bid must reach. Then win notices that arrive twice are counted once by auction id.
// Money is in mills (thousandths of a dollar) so that every language does the same integer arithmetic.

const HOURLY = [4, 3, 2, 2, 2, 3, 5, 7, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 10, 10, 10, 9, 7, 6]; // traffic weight of each hour, 160 in all
const MILLS_PER_WEIGHT_SECOND = 25; // bidding on every matching request would spend 25 mills per second per unit of weight
const DAY = 86400, HOUR = 3600;
const BUDGET = 5000 * 1000; // $5,000 a day
const REPORT_DELAY = 60; // spend reports reach the bidders and the pacer 60 seconds late
const NODE_SHARES = [16, 16, 12, 12, 12, 12, 12, 8]; // percent of the campaign's traffic seen by each of 8 bidder nodes
const COUNTER_REGIONS = 4, LATE_REGIONS = 3; // a central counter in one of 4 regions; the other 3 are too far away to answer in time

const rate = (s) => MILLS_PER_WEIGHT_SECOND * HOURLY[Math.floor(s / HOUR)]; // spend per second if we bid on everything
const potentialFrom = []; // potentialFrom[s] = spend possible from second s to midnight
potentialFrom[DAY] = 0;
for (let s = DAY - 1; s >= 0; s--) potentialFrom[s] = potentialFrom[s + 1] + rate(s);

const clock = (s) => [Math.floor(s / HOUR), Math.floor((s % HOUR) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
const dollars = (m) => `$${Math.floor(m / 1000)}.${String(Math.floor((m % 1000) / 10)).padStart(2, '0')}`;

// 1. No pacing: every node bids on everything until the spend it has heard about reaches the budget.
function noPacing() {
  const spent = [0]; // spent[s] = total spend before second s
  let outAt = -1, lastBid = -1;
  for (let s = 0; s < DAY; s++) {
    const known = s >= REPORT_DELAY ? spent[s - REPORT_DELAY] : 0;
    const spend = known < BUDGET ? rate(s) : 0;
    if (spend > 0) lastBid = s;
    spent.push(spent[s] + spend);
    if (outAt < 0 && spent[s + 1] >= BUDGET) outAt = s + 1;
  }
  return { total: spent[DAY], outAt, lastBid };
}

// 2. Local slices: every REPORT_DELAY seconds a pacer splits the next slice of budget between the nodes in proportion to
// their traffic. It plans with the newest report, which is one interval old. Each node spends its own slice with no network call.
function localSlices() {
  const spent = [0];
  let left = NODE_SHARES.map(() => 0), lastBid = -1, slices = 0;
  for (let s = 0; s < DAY; s++) {
    if (s % REPORT_DELAY === 0) {
      const known = s >= REPORT_DELAY ? spent[s - REPORT_DELAY] : 0;
      const end = Math.min(s + REPORT_DELAY, DAY);
      const slice = Math.floor((Math.max(0, BUDGET - known) * (potentialFrom[s] - potentialFrom[end])) / potentialFrom[s]);
      left = NODE_SHARES.map((share) => Math.floor((slice * share) / 100)); // an unspent slice is taken back
      slices++;
    }
    let spend = 0;
    NODE_SHARES.forEach((share, i) => {
      const supply = (rate(s) * share) / 100; // what this node could spend in this second
      const used = Math.min(supply, left[i]);
      left[i] -= used;
      spend += used;
    });
    if (spend > 0) lastBid = s;
    spent.push(spent[s] + spend);
  }
  return { total: spent[DAY], lastBid, slices };
}

// 3. Central counter: exact, but a bid from a far region waits a long round trip and misses the exchange's deadline.
function centralCounter() {
  let scaled = 0; // spend times COUNTER_REGIONS, so a quarter of a mill is still a whole number
  for (let s = 0; s < DAY; s++) {
    const target = Math.floor((BUDGET * (potentialFrom[0] - potentialFrom[s + 1])) / potentialFrom[0]); // even plan
    const reachable = rate(s) * (COUNTER_REGIONS - LATE_REGIONS); // only the counter's own region answers in time
    scaled += Math.max(0, Math.min(reachable, target * COUNTER_REGIONS - scaled));
  }
  return { total: Math.floor(scaled / COUNTER_REGIONS) };
}

const a = noPacing(), b = localSlices(), c = centralCounter();
console.log(`bidding on everything would spend ${dollars(potentialFrom[0])}; the budget is ${dollars(BUDGET)}`);
console.log(`no pacing: out of budget at ${clock(a.outAt)}, last bid at ${clock(a.lastBid)}, spent ${dollars(a.total)} (${dollars(a.total - BUDGET)} over)`);
console.log(`local slices: ${b.slices} slices to ${NODE_SHARES.length} nodes, last bid at ${clock(b.lastBid)}, spent ${dollars(b.total)} (${dollars(Math.max(0, b.total - BUDGET))} over)`);
console.log(`central counter, ${LATE_REGIONS} of ${COUNTER_REGIONS} regions too far: spent ${dollars(c.total)} of ${dollars(BUDGET)}`);

// Win notices: the exchange calls the win URL again when it does not hear back in time, so some arrive twice.
const WINS = 10000, PRICE_MICROS = 2600, RETRY_EVERY = 25; // a $2.60 CPM is $0.0026 per impression
const notices = [];
for (let i = 0; i < WINS; i++) {
  notices.push(`auction-${i}`);
  if (i % RETRY_EVERY === 0) notices.push(`auction-${i}`);
}
const seen = new Set();
let billed = 0;
for (const id of notices) if (!seen.has(id)) { seen.add(id); billed++; }
const micros = (n) => `$${Math.floor((n * PRICE_MICROS) / 1e6)}.${String(Math.floor(((n * PRICE_MICROS) % 1e6) / 1e4)).padStart(2, '0')}`;
console.log(`win notices received ${notices.length}: counted naively ${micros(notices.length)}, counted once per auction ${micros(billed)}`);

if (a.outAt >= 12 * HOUR || b.total > BUDGET * 101 / 100 || billed !== WINS) process.exit(1);
