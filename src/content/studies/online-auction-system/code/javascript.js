// An auction in JavaScript: optimistic concurrency, proxy bidding, anti-sniping extension and an exactly-once close.
// All money is in whole units, so every language prints the same result.
const START = 100, STEP = 5, WINDOW = 120, MAX_EXTENSIONS = 8;

function newAuction(endsAt) {
  return { version: 0, price: START, leader: -1, leaderMax: 0, endsAt, extensions: 0, settled: false, accepted: [] };
}

// A bid says "I will pay up to max". It is only applied if the version the bidder saw is still current.
function placeBid(a, bidder, max, now, seenVersion) {
  if (a.settled || now >= a.endsAt) return 'closed';
  if (seenVersion !== a.version) return 'conflict';                 // someone else won the race: re-read and retry
  const floor = a.leader < 0 ? START : a.price + STEP;
  if (max < floor) return 'too low';
  if (a.leader < 0) { a.leader = bidder; a.leaderMax = max; }
  else if (bidder === a.leader) a.leaderMax = Math.max(a.leaderMax, max); // raising your own ceiling does not move the price
  else if (max > a.leaderMax) { a.price = Math.min(max, a.leaderMax + STEP); a.leader = bidder; a.leaderMax = max; }
  else a.price = Math.min(a.leaderMax, max + STEP);                 // the leader's proxy answers for them
  if (a.endsAt - now < WINDOW && a.extensions < MAX_EXTENSIONS) { a.endsAt = now + WINDOW; a.extensions++; } // anti-sniping
  a.version++;
  a.accepted.push({ bidder, max });
  return 'ok';
}

// The close job may be delivered several times. The first compare-and-set on "settled" wins, the others do nothing.
function closeOnce(a, orders) {
  if (a.settled) return false;
  a.settled = true;
  orders.set('order-1', { winner: a.leader, price: a.price });     // keyed by auction, so a repeat could not add a second order
  return true;
}

let seed = 77;
const rnd = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

const a = newAuction(1000);
const stats = { ok: 0, conflict: 0, low: 0 };
const tally = (r) => { if (r === 'ok') stats.ok++; else if (r === 'conflict') stats.conflict++; else if (r === 'too low') stats.low++; };
let now = 0, lastPrice = START;
while (now < a.endsAt) {
  now += 10 + rnd(25) + a.extensions * 12;                           // bidders slow down as the fight goes on
  if (now >= a.endsAt) break;
  const seen = a.version;                                            // two bidders read the same version at once
  for (const bidder of [rnd(6), rnd(6)]) {
    const max = a.price + STEP * (1 + rnd(8));
    let r = placeBid(a, bidder, max, now, seen);
    tally(r);
    if (r === 'conflict') { r = placeBid(a, bidder, max + STEP, now, a.version); tally(r); } // retry with fresh state
    if (a.price < lastPrice) throw new Error('price went down');
    lastPrice = a.price;
  }
}

const orders = new Map();
const closes = [closeOnce(a, orders), closeOnce(a, orders), closeOnce(a, orders)]; // three deliveries of the same job
// Oracle: the winner has the highest ceiling, and pays one step over the second highest (capped at their own ceiling).
const best = new Map();
for (const b of a.accepted) if (!best.has(b.bidder) || b.max > best.get(b.bidder)) best.set(b.bidder, b.max);
const ceilings = [...best.values()].sort((x, y) => y - x);
const expected = ceilings.length > 1 ? Math.min(ceilings[0], ceilings[1] + STEP) : START;
console.log(`accepted ${stats.ok}, conflicts ${stats.conflict}, too low ${stats.low}, version ${a.version}`);
console.log(`ended at ${a.endsAt} after ${a.extensions} extensions`);
console.log(`winner #${a.leader} pays ${a.price}, expected ${expected}`);
console.log(`closes: ${closes.join(',')}; orders: ${orders.size}`);
if (a.price !== expected || a.version !== stats.ok || orders.size !== 1 || closes.filter(Boolean).length !== 1) process.exit(1);
