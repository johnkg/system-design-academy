// Reconciliation: match your records with the payment provider's, classify what does not agree, count the money at stake.
// 200 generated transactions with injected breaks from a seeded generator, so every run prints the same text. Integers only.
const SEED = 20261128;
const COUNT = 200;
const PRICES = [499, 999, 1999, 4900];   // few distinct prices on purpose: many payments look alike, so a fuzzy match can pick the wrong one
const DAYS = 7;                           // transactions fall on days 1 to 7
const CLASSES = ['timing shift', 'missing at provider', 'missing in our records', 'duplicate', 'amount off by fee', 'status differs', 'no reference id'];
const feeOf = (amount) => Math.floor((amount * 290 + 5000) / 10000) + 30; // the provider's fee: 2.9% (half up) plus 30 cents

// A small seeded generator (Park-Miller): the same seed always gives the same numbers.
function makeRng(seed) { let s = seed; return (n) => { s = (s * 48271) % 2147483647; return s % n; }; }

// Your records and the provider's records of the same payments, with breaks injected at ratePct percent.
function generate(ratePct) {
  const r = makeRng(SEED);
  const ours = [], provider = [], injected = CLASSES.map(() => 0);
  for (let i = 1; i <= COUNT; i++) {
    const id = 'T' + String(i).padStart(4, '0');
    const amount = PRICES[r(PRICES.length)], day = 1 + r(DAYS), status = r(100) < 15 ? 'refunded' : 'captured';
    const broken = r(100) < ratePct, cls = r(CLASSES.length); // always drawn, so a higher rate only adds breaks
    const row = { id, trueId: id, amount, day, status };
    const mine = { id, amount, day, status };
    const kind = broken ? cls : -1;
    if (broken) injected[cls]++;
    if (kind !== 2) ours.push(mine);              // missing in our records: the provider has it, we never wrote it down
    if (kind === 1) continue;                     // missing at provider: no row on their side
    if (kind === 0) row.day = day + 1;            // paid at 23:59, booked by the provider the next day
    if (kind === 4) row.amount = amount - feeOf(amount); // the provider reports the amount net of its fee
    if (kind === 5) row.status = status === 'captured' ? 'refunded' : 'captured';
    if (kind === 6) row.id = '';                  // the reference did not make it into the provider's file
    provider.push(row);
    if (kind === 3) provider.push({ ...row });    // the same payment delivered twice
  }
  return { ours, provider, injected };
}

// rule: 'id' (the id alone), 'fee' (id, and the amount may be lower by the fee), 'window' (id, and the date within n days),
// 'fuzzy' (id; rows without an id are matched by amount and a date within n days).
function reconcile(data, rule, n) {
  const byId = new Map(data.ours.map((o) => [o.id, o]));
  const matchedOurs = new Set(), pairs = [], unmatchedP = [], deferred = [];
  for (const p of data.provider) {
    if (p.id === '') { deferred.push(p); continue; }
    const o = byId.get(p.id);
    if (!o || matchedOurs.has(o.id)) { unmatchedP.push(p); continue; } // unknown id, or a second row for an id already matched
    const ok = rule === 'fee' ? p.amount <= o.amount && o.amount - p.amount <= feeOf(o.amount) : rule === 'window' ? Math.abs(p.day - o.day) <= n : true;
    if (ok) { matchedOurs.add(o.id); pairs.push([o, p]); } else unmatchedP.push(p);
  }
  for (const p of deferred) {
    if (rule !== 'fuzzy') { unmatchedP.push(p); continue; }
    let best = null;
    for (const o of data.ours) {
      if (matchedOurs.has(o.id) || o.amount !== p.amount || Math.abs(o.day - p.day) > n) continue;
      if (!best || Math.abs(o.day - p.day) < Math.abs(best.day - p.day)) best = o; // closest date, then the lowest id
    }
    if (best) { matchedOurs.add(best.id); pairs.push([best, p]); } else unmatchedP.push(p);
  }
  const unmatchedO = data.ours.filter((o) => !matchedOurs.has(o.id));

  // Classify what is left, from what can be seen in the two files.
  const exceptions = {};
  const add = (cls, text) => { (exceptions[cls] ||= []).push(text); };
  const usedP = new Set();
  for (const o of unmatchedO) {
    const p = unmatchedP.find((x) => x.id === o.id && !usedP.has(x));
    if (p) { usedP.add(p); add('same id, rejected by the rule', o.id); } else add('missing at provider', o.id);
  }
  for (const p of unmatchedP) {
    if (usedP.has(p)) continue;
    if (p.id === '') add('no reference id', `${p.amount} on day ${p.day}`);
    else if (matchedOurs.has(p.id)) add('duplicate', p.id);
    else add('missing in our records', p.id);
  }
  for (const [o, p] of pairs) {
    if (o.day !== p.day) add('date differs', o.id);
    if (o.amount !== p.amount && !(rule === 'fee' && p.amount < o.amount && o.amount - p.amount <= feeOf(o.amount))) add('amount differs', o.id);
    if (o.status !== p.status) add('status differs', o.id);
  }
  const correct = pairs.filter(([o, p]) => o.id === p.trueId).length;
  const sum = (rows) => rows.reduce((s, x) => s + x.amount, 0);
  let unexplained = sum(unmatchedO) + sum(unmatchedP);
  for (const [o, p] of pairs) {
    const tolerated = rule === 'fee' && p.amount <= o.amount && o.amount - p.amount <= feeOf(o.amount);
    if (!tolerated) unexplained += Math.abs(o.amount - p.amount);
  }
  return { matched: pairs.length, correct, falseMatches: pairs.length - correct, unmatchedO: unmatchedO.length, unmatchedP: unmatchedP.length,
    difference: sum(data.ours) - sum(data.provider), unexplained, exceptions };
}

const RULES = [['id', 'exact id only'], ['fee', 'id and amount within the fee'], ['window', 'id and date within the window'], ['fuzzy', 'id, then fuzzy by amount and date']];
for (const ratePct of [0, 10, 25]) {
  const data = generate(ratePct);
  console.log(`-- break rate ${ratePct}%: ${data.ours.length} of our records, ${data.provider.length} of the provider's, ${data.injected.reduce((a, b) => a + b, 0)} breaks injected`);
  console.log(`  injected: ${CLASSES.map((c, i) => `${c} ${data.injected[i]}`).join(', ')}`);
  for (const [rule, label] of RULES) {
    for (const n of rule === 'id' || rule === 'fee' ? [1] : [0, 1, 3]) {
      if (ratePct === 0 && n !== 1) continue;
      const x = reconcile(data, rule, n);
      const ex = Object.entries(x.exceptions).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([c, l]) => `${c} ${l.length}`).join(', ') || 'none';
      console.log(`  ${label}${rule === 'window' || rule === 'fuzzy' ? ` (${n} days)` : ''}: matched ${x.matched} (false ${x.falseMatches}), unmatched ours ${x.unmatchedO}, provider ${x.unmatchedP}; money difference ${x.difference}, unexplained ${x.unexplained}; ${ex}`);
    }
  }
}
