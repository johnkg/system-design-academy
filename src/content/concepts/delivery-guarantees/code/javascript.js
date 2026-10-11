// Four consumer styles over the same seeded crash schedule. Payment events are charged to a card API
// and recorded in a ledger. Intended final state: every payment charged once and recorded once.
const N = 12;
const amountOf = (id) => 10 + ((id * 7) % 30);

// Deterministic fault for (message, attempt): the same schedule hits every style. 25 % of attempts fail.
function fault(seed, id, attempt, rate) {
  let x = (Math.imul(seed, 7919) + Math.imul(id, 104729) + Math.imul(attempt, 1299709) + 12345) >>> 0;
  for (let i = 0; i < 3; i++) x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
  if ((x >>> 16) % 1000 >= rate) return 'ok';
  const s = (x >>> 8) % 100;
  return s < 30 ? 'crashBefore' : s < 55 ? 'crashMid' : s < 80 ? 'crashAfter' : 'lostAck';
}

function run(style, seed, rate, cardKey) {
  const ledger = new Array(N).fill(0), card = new Array(N).fill(0), seen = new Set();
  const charge = (id) => { if (!(cardKey && card[id] > 0)) card[id]++; }; // provider honours the key
  for (let id = 0; id < N; id++) {
    if (style === 'ack-before') {            // offset moves first: one try, no redelivery
      const f = fault(seed, id, 0, rate);
      if (f === 'crashBefore') continue;     // lost
      charge(id);
      if (f === 'crashMid') continue;        // charged, never recorded, lost
      ledger[id]++;
      continue;
    }
    for (let attempt = 0; attempt < 50; attempt++) {
      const f = fault(seed, id, attempt, rate);
      if (f === 'crashBefore') continue;                       // redelivered
      if (style === 'idempotent' && seen.has(id)) break;       // unique key hit: skip and ack
      charge(id);
      if (f === 'crashMid') continue;                          // transaction never committed
      ledger[id]++;
      if (style === 'idempotent') seen.add(id);                // same transaction as the ledger row
      if (style === 'transactional') break;                    // offset committed with the row
      if (f === 'ok') break;                                   // ack arrived
    }                                                          // crashAfter / lostAck: redelivered
  }
  let lost = 0, dupLedger = 0, dupCard = 0, ledgerTotal = 0, cardTotal = 0, want = 0;
  for (let i = 0; i < N; i++) {
    if (ledger[i] === 0) lost++;
    dupLedger += Math.max(0, ledger[i] - 1); dupCard += Math.max(0, card[i] - 1);
    ledgerTotal += ledger[i] * amountOf(i); cardTotal += card[i] * amountOf(i); want += amountOf(i);
  }
  return { lost, dupLedger, dupCard, ledgerTotal, cardTotal, want };
}

const show = (name, r) => console.log(`${name.padEnd(14)} lost=${r.lost} dupLedger=${r.dupLedger} dupCard=${r.dupCard} ledger=${r.ledgerTotal} card=${r.cardTotal} intended=${r.want}`);
const R = {};
for (const style of ['ack-before', 'ack-after', 'idempotent', 'transactional']) { R[style] = run(style, 1, 250, false); show(style, R[style]); }
console.log('-- card API honours an idempotency key --');
const K = {};
for (const style of ['ack-before', 'ack-after', 'idempotent', 'transactional']) { K[style] = run(style, 1, 250, true); show(style, K[style]); }

const must = (c, m) => { if (!c) { console.error('FAILED: ' + m); process.exit(1); } };
must(R['ack-before'].lost > 0, 'ack-before loses messages');
must(R['ack-before'].dupLedger === 0, 'ack-before never duplicates');
must(R['ack-after'].lost === 0 && R['ack-after'].dupLedger > 0, 'ack-after loses nothing but duplicates');
must(R['idempotent'].lost === 0 && R['idempotent'].ledgerTotal === R['idempotent'].want, 'idempotent consumer reaches the intended ledger');
must(R['idempotent'].dupCard > 0, 'without a card key the external charge is still repeated');
must(R['transactional'].lost === 0 && R['transactional'].dupLedger === 0, 'transactional consumer has no duplicate ledger rows');
must(K['idempotent'].cardTotal === K['idempotent'].want && K['idempotent'].ledgerTotal === K['idempotent'].want, 'dedupe plus card key is exactly the intended state');
must(K['transactional'].cardTotal === K['transactional'].want, 'transactional plus card key is exactly the intended state');
console.log('all invariants hold');
