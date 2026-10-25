// A flight search fan-out in JavaScript: ask every provider at once with its own timeout and one global deadline, stream the
// answers as they arrive, serve fares from a short-lived cache, skip a failing provider with a circuit breaker, merge the same
// itinerary sold by several providers, and check the chosen price live before handing the traveller over.
// Time is simulated (milliseconds within a search, minutes between searches), so every run prints the same thing.

const DEADLINE_MS = 3000; // the whole search closes here
const TIMEOUT_FACTOR = 2; // a provider's own timeout is twice its typical latency, capped by the deadline
const TTL_MIN = 5; // a cached fare is served for 5 minutes
const BREAKER_FAILS = 2; // failures in a row that open a provider's breaker
const BREAKER_OPEN_MIN = 4; // minutes the breaker stays open before one trial call
const CACHE_MS = 5; // time to answer from the cache
const JITTER_MIN = 50, JITTER_SPAN = 100; // a live call takes 50% to 149% of the provider's typical latency

const PROVIDERS = [
  { name: 'airline-1', typical: 400, markup: 0 },
  { name: 'airline-2', typical: 700, markup: 0 },
  { name: 'ota-1', typical: 1200, markup: 9 },
  { name: 'ota-2', typical: 1500, markup: 4 },
  { name: 'gds-1', typical: 2000, markup: -6 },
];
const ITINERARIES = [ // the same flights are sold by several providers
  { key: 'XA101', label: '07:10 nonstop 7h10', base: 420, sellers: [0, 2, 3, 4] },
  { key: 'XA105', label: '13:40 nonstop 7h25', base: 395, sellers: [0, 3, 4] },
  { key: 'YB220+YB31', label: '09:05 one stop 10h40', base: 330, sellers: [1, 2, 4] },
];
const FARE_RISE = { key: 'YB220+YB31', minute: 7, by: 34 }; // the cheap fare class sells out at minute 7
const OUTAGE = { provider: 4, from: 5, to: 11 }; // gds-1 stops answering from minute 5 to minute 11
const SEARCHES = [0, 3, 6, 7, 8, 12]; // minutes at which travellers search the same route
const SELECT_AT = 8; // the traveller at minute 8 picks the cheapest result

let seed = 7;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

const fare = (it, minute) => it.base + (it.key === FARE_RISE.key && minute >= FARE_RISE.minute ? FARE_RISE.by : 0);
const offersOf = (p, minute) => ITINERARIES.filter((it) => it.sellers.includes(p)).map((it) => ({ key: it.key, price: fare(it, minute) + PROVIDERS[p].markup, seller: p }));

const cache = new Map(); // provider -> { at, offers }
const breakers = PROVIDERS.map(() => ({ fails: 0, openUntil: -1 }));
const totals = { live: 0, cached: 0, timeouts: 0, skipped: 0 };

function search(minute) {
  const events = []; // { at, p, text, offers }
  for (let p = 0; p < PROVIDERS.length; p++) {
    const prov = PROVIDERS[p], hit = cache.get(p), br = breakers[p];
    if (hit && minute - hit.at < TTL_MIN) { totals.cached++; events.push({ at: CACHE_MS, p, text: `${plural(hit.offers.length, 'offer')} from cache (age ${minute - hit.at} min)`, offers: hit.offers }); continue; }
    if (br.openUntil > minute) { totals.skipped++; events.push({ at: 0, p, text: 'skipped, breaker open', offers: [] }); continue; }
    totals.live++;
    const timeout = Math.min(TIMEOUT_FACTOR * prov.typical, DEADLINE_MS);
    const latency = Math.floor((prov.typical * (JITTER_MIN + random(JITTER_SPAN))) / 100);
    const down = p === OUTAGE.provider && minute >= OUTAGE.from && minute < OUTAGE.to;
    if (down || latency > timeout) {
      totals.timeouts++; br.fails++;
      let text = `no answer, gave up at ${timeout} ms`;
      if (br.fails >= BREAKER_FAILS) { br.openUntil = minute + BREAKER_OPEN_MIN; text += `; breaker opens until minute ${br.openUntil}`; }
      events.push({ at: timeout, p, text, offers: [] });
      continue;
    }
    br.fails = 0;
    const offers = offersOf(p, minute);
    cache.set(p, { at: minute, offers });
    events.push({ at: latency, p, text: `${plural(offers.length, 'offer')} live`, offers });
  }
  events.sort((a, b) => a.at - b.at || a.p - b.p);
  console.log(`search at minute ${minute}`);
  for (const e of events) console.log(`  +${String(e.at).padStart(4)} ms  ${PROVIDERS[e.p].name.padEnd(9)} ${e.text}`); // streamed to the browser in this order
  const answered = events.filter((e) => e.offers.length);
  const first = answered.length ? answered[0].at : DEADLINE_MS;
  const complete = Math.max(0, ...events.map((e) => e.at));
  console.log(`  first prices after ${first} ms, search complete after ${complete} ms, ${answered.length} of ${PROVIDERS.length} providers answered`);
  return merge(answered.flatMap((e) => e.offers));
}

// One row per itinerary, with every seller's price, sorted by the best price.
function merge(offers) {
  const rows = ITINERARIES.map((it) => ({ it, offers: offers.filter((o) => o.key === it.key).sort((a, b) => a.price - b.price || a.seller - b.seller) }))
    .filter((r) => r.offers.length)
    .sort((a, b) => a.offers[0].price - b.offers[0].price || (a.it.key < b.it.key ? -1 : 1));
  console.log(`  merged ${offers.length} offers into ${rows.length} itineraries:`);
  for (const r of rows) console.log(`    ${r.it.label.padEnd(21)} ${r.offers[0].price} at ${PROVIDERS[r.offers[0].seller].name}, ${r.offers.length} sellers`);
  return rows;
}

let chosen = null;
for (const minute of SEARCHES) {
  const rows = search(minute);
  if (minute === SELECT_AT) chosen = { minute, row: rows[0] };
}

// The traveller clicks the top result. The shown price may come from the cache, so ask the seller for the live price first.
const best = chosen.row.offers[0];
const it = chosen.row.it;
const live = fare(it, chosen.minute) + PROVIDERS[best.seller].markup;
console.log(`selected ${it.key} at ${best.price} from ${PROVIDERS[best.seller].name}; live price check says ${live}`);
console.log(live === best.price ? 'price confirmed, handing over to the seller' : `price changed by ${live - best.price}, shown to the traveller before handing over`);
console.log(`provider calls ${totals.live}, answered from cache ${totals.cached}, timed out ${totals.timeouts}, skipped by breaker ${totals.skipped}`);

if (totals.cached === 0 || totals.skipped === 0 || live === best.price) process.exit(1);
