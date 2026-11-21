// A strangler migration, request by request. 200 customers, 4,000 requests. A share of customers is routed to a new
// service with its own database; the monolith keeps the rest. Reads and writes hit one store or the other, and the
// two stores are kept in step by one of four methods. Legacy reports (30% of reads) always read the monolith's
// database. Everything is integers from a seeded generator, so the output never changes.
const CUSTOMERS = 200, TICKS = 4000;
const WRITE_PCT = 30;       // share of requests that update a customer
const LEGACY_PCT = 30;      // share of reads done by legacy modules that only know the monolith database
const DUAL_FAIL_PCT = 10;   // dual writes: the second write silently fails this often
const LAG = 12;             // outbox relay: requests between a write and its copy arriving
const CHECK_EVERY = 1000;   // parity check: compare and repair every this many requests
const ROLLBACK_AT = 2400;   // the request at which a rollback happens, if asked for
const CHANGES = [800, 1600, 2400, 3200], CHANGE_LEN = 80; // schema changes: owners alternate, the other side breaks

function run(name, { pct, mode, parity, rollback }) {
  let seed = 12345;
  const rnd = () => (seed = (seed * 48271) % 2147483647);
  const truth = new Array(CUSTOMERS).fill(0), oldDb = new Array(CUSTOMERS).fill(0), newDb = new Array(CUSTOMERS).fill(0);
  const relay = []; // {due, c, v, toNew}
  let reads = 0, wrong = 0, failed = 0, found = 0, lastRate = 0, behind = 0, rolled = false, windowWrong = 0;
  for (let t = 0; t < TICKS; t++) {
    const c = rnd() % CUSTOMERS, isWrite = rnd() % 100 < WRITE_PCT, legacy = rnd() % 100 < LEGACY_PCT, lose = rnd() % 100 < DUAL_FAIL_PCT;
    for (let i = relay.length - 1; i >= 0; i--) {
      const m = relay[i];
      if (m.due <= t) { const db = m.toNew ? newDb : oldDb; db[m.c] = Math.max(db[m.c], m.v); relay.splice(i, 1); }
    }
    if (rollback && t === ROLLBACK_AT) { rolled = true; for (let i = 0; i < CUSTOMERS; i++) if (oldDb[i] !== truth[i]) behind++; }
    const onNew = !rolled && (c * 7919) % 100 < pct;
    const side = !isWrite && legacy ? 'old' : onNew ? 'new' : 'old';
    const k = CHANGES.findIndex((s) => t >= s && t < s + CHANGE_LEN);
    if (mode === 'shared' && pct > 0 && k >= 0 && side === (k % 2 === 0 ? 'new' : 'old')) failed++;
    else if (isWrite) {
      const v = ++truth[c];
      (onNew ? newDb : oldDb)[c] = v;
      if (pct === 0) { /* nothing to keep in step */ }
      else if (mode === 'shared') (onNew ? oldDb : newDb)[c] = v;
      else if (mode === 'none') { /* the new service owns the data, nothing is copied */ }
      else if (mode === 'dual') { if (!lose) (onNew ? oldDb : newDb)[c] = Math.max((onNew ? oldDb : newDb)[c], v); }
      else relay.push({ due: t + LAG, c, v, toNew: !onNew });
    } else {
      reads++;
      const seen = side === 'new' ? newDb[c] : oldDb[c];
      if (seen !== truth[c]) { wrong++; windowWrong++; }
    }
    if (parity && pct > 0 && (t + 1) % CHECK_EVERY === 0) {
      let diff = 0;
      for (let i = 0; i < CUSTOMERS; i++) if (oldDb[i] !== newDb[i]) { diff++; oldDb[i] = newDb[i] = Math.max(oldDb[i], newDb[i]); }
      found += diff; lastRate = Math.floor((diff * 100) / CUSTOMERS);
    }
  }
  let drift = 0; // with nothing moved there is no second store to compare
  for (let i = 0; i < CUSTOMERS; i++) if (oldDb[i] !== newDb[i]) drift++;
  if (pct === 0) drift = 0;
  const coordinated = mode === 'shared' && pct > 0 ? CHANGES.length : 0;
  console.log(`-- ${name}`);
  console.log(`  wrong reads: ${wrong} of ${reads}; failed requests during schema changes: ${failed} (${coordinated} releases needed both teams)`);
  console.log(`  customers out of sync at the end: ${drift} of ${CUSTOMERS}; parity checks found ${found} (last check ${lastRate}%)`);
  console.log(`  rollback: ${rollback ? `${behind} customers had updates the monolith never received` : 'not used'}`);
}

run('nothing moved', { pct: 0, mode: 'dual', parity: false, rollback: false });
run('50% moved, no copy between the databases', { pct: 50, mode: 'none', parity: false, rollback: false });
run('50% moved, dual writes, no checks', { pct: 50, mode: 'dual', parity: false, rollback: false });
run('50% moved, shared database kept for now', { pct: 50, mode: 'shared', parity: false, rollback: false });
run('50% moved, outbox relay', { pct: 50, mode: 'outbox', parity: false, rollback: false });
run('50% moved, dual writes, parity check and repair', { pct: 50, mode: 'dual', parity: true, rollback: false });
run('50% moved, dual writes, rollback at 2400', { pct: 50, mode: 'dual', parity: false, rollback: true });
run('100% moved, outbox relay, parity check, rollback at 2400', { pct: 100, mode: 'outbox', parity: true, rollback: true });
