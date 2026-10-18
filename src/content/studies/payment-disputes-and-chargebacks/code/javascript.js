// A dispute engine in JavaScript: idempotent notices, a state machine, durable deadlines, evidence packing and ledger entries.
// Money is in cents and time is in whole days, so the run is deterministic.
const ALLOWED = {
  opened: ['evidence_requested', 'accepted', 'lost'],
  evidence_requested: ['evidence_submitted', 'accepted', 'lost'],
  evidence_submitted: ['won', 'lost'],
  won: [], lost: [], accepted: [],
};
const FEE = 1500;       // the network's dispute fee, charged when a dispute opens
const LIMIT_KB = 4500;  // the network's cap on the whole evidence packet

const newStore = () => ({ disputes: {}, seen: {}, ledger: [], refunded: {} });
const post = (s, did, kind, cents) => s.ledger.push({ did, kind, cents });

// A state change is allowed only along the table. The ledger effect belongs to the change, so the two cannot drift apart.
function move(s, d, to) {
  if (!ALLOWED[d.state].includes(to)) return false;
  d.state = to;
  if (to === 'won') post(s, d.id, 'reversal', d.amount);
  return true;
}

function ingest(s, n) {
  if (s.seen[n.nid]) return 'duplicate, ignored';   // the same notice arrives by webhook and again in the batch file
  s.seen[n.nid] = true;
  if (n.type === 'opened') {
    s.disputes[n.did] = { id: n.did, amount: n.amount, state: 'opened', due: n.due, refunded: !!s.refunded[n.did], evidence: [] };
    post(s, n.did, 'provisional debit', -n.amount);
    post(s, n.did, 'fee', -FEE);
    return `created, respond by day ${n.due}`;
  }
  const d = s.disputes[n.did];
  if (!d) return 'unknown dispute';
  return move(s, d, n.type) ? `now ${n.type}` : `rejected ${n.type} while ${d.state}`;
}

// Fill the packet in priority order and skip whatever does not fit.
function pack(items) {
  let used = 0; const chosen = [];
  for (const it of items) if (used + it.kb <= LIMIT_KB) { used += it.kb; chosen.push(it.name); }
  return { chosen, used };
}

function submit(s, did, day, items) {
  const d = s.disputes[did];
  if (d.state !== 'evidence_requested' || day > d.due) return 'too late or wrong state';
  const p = pack(items); d.evidence = p.chosen; move(s, d, 'evidence_submitted');
  return `${p.chosen.length} of ${items.length} items, ${p.used} KB of ${LIMIT_KB}`;
}

// A refund of a disputed charge would pay the customer twice, so it waits until the dispute is won.
function refund(s, did) {
  const d = s.disputes[did];
  if (d && d.state !== 'won') return `blocked, dispute is ${d.state}`;
  s.refunded[did] = true; return 'allowed';
}

// The sweeper reads only stored deadlines, so it gives the same answer after a restart.
function sweep(s, today) {
  const out = [];
  for (const d of Object.values(s.disputes)) {
    if (d.state !== 'opened' && d.state !== 'evidence_requested') continue;
    if (d.due < today) { move(s, d, 'lost'); out.push(`${d.id} lost, deadline day ${d.due} missed`); }
    else if (d.due - today <= 2) out.push(`${d.id} reminder, ${d.due - today} days left`);
  }
  return out;
}

let store = newStore();
const say = (label, text) => console.log(`${label}: ${text}`);
say('refund dp_4 before any dispute', refund(store, 'dp_4'));
const feed = [
  { nid: 'n1', type: 'opened', did: 'dp_1', amount: 8000, due: 7 }, { nid: 'n1', type: 'opened', did: 'dp_1', amount: 8000, due: 7 },
  { nid: 'n2', type: 'evidence_requested', did: 'dp_1' }, { nid: 'n3', type: 'opened', did: 'dp_2', amount: 2500, due: 8 },
  { nid: 'n4', type: 'evidence_requested', did: 'dp_2' }, { nid: 'n5', type: 'opened', did: 'dp_3', amount: 4000, due: 9 },
  { nid: 'n6', type: 'evidence_requested', did: 'dp_3' }, { nid: 'n7', type: 'opened', did: 'dp_4', amount: 1200, due: 10 },
];
for (const n of feed) say(`${n.nid} ${n.did}`, ingest(store, n));
say('refund dp_1 while open', refund(store, 'dp_1'));
const items = [{ name: 'receipt', kb: 300 }, { name: 'delivery proof', kb: 1200 }, { name: 'chat log', kb: 2800 }, { name: 'device log', kb: 900 }, { name: 'photos', kb: 1500 }];
say('submit dp_1 on day 3', submit(store, 'dp_1', 3, items));
say('accept dp_3', move(store, store.disputes.dp_3, 'accepted') ? 'accepted' : 'refused');
say('n8 dp_3', ingest(store, { nid: 'n8', type: 'won', did: 'dp_3' }));
store = JSON.parse(JSON.stringify(store)); // restart: everything comes back from stored rows
say('restart', `${Object.keys(store.disputes).length} disputes reloaded`);
for (const line of sweep(store, 6)) say('sweep day 6', line);
for (const line of sweep(store, 11)) say('sweep day 11', line);
say('n9 dp_1', ingest(store, { nid: 'n9', type: 'won', did: 'dp_1' }));

const net = {};
for (const e of store.ledger) net[e.did] = (net[e.did] ?? 0) + e.cents;
for (const d of Object.values(store.disputes)) console.log(`${d.id} ${d.state} net ${net[d.id]}${d.refunded ? ' (refunded first)' : ''}`);
const total = Object.values(net).reduce((a, b) => a + b, 0);
console.log(`merchant balance change ${total}`);
const ok = net.dp_1 === -FEE && net.dp_2 === -2500 - FEE && net.dp_3 === -4000 - FEE && net.dp_4 === -1200 - FEE && total === -13700 && store.ledger.length === 9;
if (!ok) process.exit(1);
