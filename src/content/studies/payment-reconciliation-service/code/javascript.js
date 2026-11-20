// A reconciliation run over 3 days of card payments, three sources (ledger, processor files, bank deposits), with
// injected breaks: a late file, a duplicate file, a corrected file, missing rows, lost references, fee differences,
// refunds and chargebacks, and processors that cut the day off in different time zones.
// Money is integer cents and the "random" payments come from a seeded generator, so the output never changes.
const DAY = 1440;                 // minutes in a day
const PER_DAY = 200, DAYS = 3;    // payments per day, days of payments (UTC days 1 to 3)
const BUCKETS = 5;                // business days 0 to 4: refunds and chargebacks land later, and time zones shift the day
const OFFSET = [0, 60, -480];     // minutes from UTC where each processor cuts the day: UTC, UTC+1, UTC-8
const SEED = 20260115;
const REFUND_AFTER = 1500, CHARGEBACK_AFTER = 2900; // minutes after the payment

let seed = SEED;
const next = (n) => { seed = (seed * 48271) % 2147483647; return seed % n; }; // Park-Miller, stays below 2^53
const fee = (amount) => Math.floor((amount * 29 + 500) / 1000) + 30;            // 2.9% plus 30 cents, rounded half up

// One line of money: a sale (0), a refund (1) or a chargeback (2). `ref` is false when the processor lost the reference.
const line = (pid, type, t, net, tail, proc, ref, big) => ({ pid, type, t, net, tail, proc, ref, big, age: 0 });
const copy = (l, net, big) => ({ ...l, net, big, age: 0 });
const sum = (ls, f) => ls.reduce((s, l) => s + f(l), 0);

function generate() {
  seed = SEED;
  const ledger = [], truth = []; // ledger lines, and what the processors really reported
  for (let i = 0; i < DAYS * PER_DAY; i++) {
    const day = 1 + Math.floor(i / PER_DAY);
    const t = day * DAY + next(DAY), amount = 500 + next(19501), tail = next(10000), proc = next(3);
    const r = next(100), small = 1 + next(4), large = 200 + next(101);
    let kind = r < 2 ? 'missing' : r < 3 ? 'ghost' : r < 6 ? 'lost' : r < 14 ? 'fee' : r < 15 ? 'bigfee' : r < 17 ? 'chargeback' : r < 20 ? 'refund' : 'normal';
    if (kind === 'chargeback' && day !== 1) kind = 'normal';
    if (kind === 'refund' && day > 2) kind = 'normal';
    const expected = amount - fee(amount);
    if (kind !== 'ghost') ledger.push(line(i, 0, t, expected, tail, proc, true, false));
    if (kind === 'refund') ledger.push(line(i, 1, t + REFUND_AFTER, -amount, tail, proc, true, false));
    if (kind !== 'missing') {
      const net = kind === 'fee' ? expected - small : kind === 'bigfee' ? expected - large : expected;
      truth.push(line(i, 0, t, net, tail, proc, kind !== 'lost', kind === 'bigfee'));
      if (kind === 'refund') truth.push(line(i, 1, t + REFUND_AFTER, -amount, tail, proc, true, false));
      if (kind === 'chargeback') truth.push(line(i, 2, t + CHARGEBACK_AFTER, -amount, tail, proc, true, false));
    }
  }
  return { ledger, truth };
}

function run(name, { strategy, tolerance, idempotent, perProcessorCutoff }) {
  const { ledger, truth } = generate();
  const grid = () => [0, 1, 2].map(() => Array.from({ length: BUCKETS }, () => []));
  const Lb = grid(), Tb = grid();
  for (const l of ledger) Lb[l.proc][Math.floor((l.t + (perProcessorCutoff ? OFFSET[l.proc] : 0)) / DAY)].push(l);
  for (const l of truth) Tb[l.proc][Math.floor((l.t + OFFSET[l.proc]) / DAY)].push(l);
  // What the loader has stored for each processor and day. An idempotent load keeps one version of each row.
  const Pb = Tb.map((row) => row.map((ls) => ls.map((l) => copy(l, l.net, l.big))));
  let duplicateMoney = 0;
  if (!idempotent) {
    Pb[1][3] = Pb[1][3].concat(Pb[1][1]); Pb[1][1] = [];                                   // late file: arrives 2 days after its day
    duplicateMoney += sum(Pb[2][2], (l) => Math.abs(l.net));
    Pb[2][2] = Pb[2][2].concat(Pb[2][2].map((l) => copy(l, l.net, l.big)));              // the same file delivered twice, both loaded
    Pb[0][2] = Tb[0][2].map((l) => (l.pid % 5 === 0 ? copy(l, l.net + 1000, true) : copy(l, l.net, l.big))); // first version, 1 row in 5 wrong
    Pb[0][3] = Pb[0][3].concat(Tb[0][2].map((l) => copy(l, l.net, l.big)));              // the corrected file, loaded next to it
    duplicateMoney += sum(Tb[0][2], (l) => Math.abs(l.net));
  }
  let notTying = 0;
  for (let p = 0; p < 3; p++) for (let b = 0; b < BUCKETS; b++) if (sum(Pb[p][b], (l) => l.net) !== sum(Tb[p][b], (l) => l.net)) notTying++;

  const single = strategy === 'single', window = single ? 0 : 1;
  let matched = 0, resolved = 0, falsePairs = 0, wrongMoney = 0;
  const breaks = []; // [class, cents]
  for (let p = 0; p < 3; p++) {
    const paired = new Array(DAYS * PER_DAY * 3).fill(0); // 1: key paired cleanly, 2: key paired with a wrong amount
    const key = (l) => l.pid * 3 + l.type;
    let carryL = [], carryP = [];
    const miss = [], orphan = [];
    for (let b = 0; b < BUCKETS; b++) {
      const Ls = carryL.concat(Lb[p][b]), Ps = carryP.concat(Pb[p][b]);
      carryL = []; carryP = [];
      const uL = Ls.map(() => false), uP = Ps.map(() => false);
      for (let i = 0; i < Ls.length; i++) {                      // tiers 1 and 2: same reference, exact amount or within tolerance
        for (let j = 0; j < Ps.length; j++) {
          if (uP[j] || !Ps[j].ref || key(Ps[j]) !== key(Ls[i])) continue;
          uL[i] = uP[j] = true;
          const diff = Math.abs(Ls[i].net - Ps[j].net);
          if (diff === 0) { matched++; paired[key(Ls[i])] = 1; }
          else if (!single && diff <= tolerance) { matched++; resolved++; paired[key(Ls[i])] = 1; if (Ps[j].big) wrongMoney += diff; }
          else { breaks.push(['amount', diff]); paired[key(Ls[i])] = 2; }
          break;
        }
      }
      for (let j = 0; j < Ps.length; j++) {                      // a second row for a reference that is already paired
        if (uP[j] || !Ps[j].ref || paired[key(Ps[j])] === 0) continue;
        uP[j] = true;
        if (!single && paired[key(Ps[j])] === 1) resolved++; else breaks.push(['duplicate', Math.abs(Ps[j].net)]);
      }
      if (!single) {                                             // tier 3: fuzzy, on amount, card tail and type
        for (let i = 0; i < Ls.length; i++) {
          if (uL[i]) continue;
          for (let j = 0; j < Ps.length; j++) {
            const x = Ps[j];
            if (uP[j] || x.type !== Ls[i].type || Math.abs(Ls[i].net - x.net) > tolerance) continue;
            if (strategy === 'tiered' && (x.ref || x.tail !== Ls[i].tail)) continue;
            uL[i] = uP[j] = true; matched++;
            if (x.pid !== Ls[i].pid) { falsePairs++; wrongMoney += Math.abs(Ls[i].net); } else resolved++;
            break;
          }
        }
      }
      for (let i = 0; i < Ls.length; i++) if (!uL[i]) { if (window && Ls[i].age === 0 && b < BUCKETS - 1) { Ls[i].age = 1; carryL.push(Ls[i]); } else miss.push(Ls[i]); }
      for (let j = 0; j < Ps.length; j++) if (!uP[j]) { if (window && Ps[j].age === 0 && b < BUCKETS - 1) { Ps[j].age = 1; carryP.push(Ps[j]); } else orphan.push(Ps[j]); }
    }
    const used = orphan.map(() => false);
    for (const l of miss) {                                      // a line missing on one side and extra on the other is a timing break
      const j = orphan.findIndex((x, k) => !used[k] && x.ref && x.pid === l.pid && x.type === l.type);
      if (j >= 0) { used[j] = true; breaks.push(['timing', Math.abs(l.net)]); } else breaks.push(['missing', Math.abs(l.net)]);
    }
    orphan.forEach((x, k) => { if (!used[k]) breaks.push([x.type === 2 ? 'status' : 'missing', Math.abs(x.net)]); });
  }
  const count = (c) => breaks.filter((x) => x[0] === c).length;
  const total = ledger.length;
  console.log(`-- ${name}`);
  console.log(`  matched ${Math.floor((matched * 100) / total)}% (${matched} of ${total} ledger lines), ${resolved} resolved by rules`);
  console.log(`  breaks for people ${breaks.length}: timing ${count('timing')}, missing ${count('missing')}, amount ${count('amount')}, duplicate ${count('duplicate')}, status ${count('status')}`);
  console.log(`  unexplained ${sum(breaks, (x) => x[1])} cents, duplicate-counted ${duplicateMoney} cents, bank deposits not tying ${notTying} of 15`);
  console.log(`  wrongly matched ${falsePairs} pairs, ${wrongMoney} cents marked reconciled but wrong`);
}

const weak = { strategy: 'single', tolerance: 0, idempotent: false, perProcessorCutoff: false };
run('single pass on exact id, files appended, UTC cut-off', weak);
run('single pass, each processor on its own time zone', { ...weak, perProcessorCutoff: true });
run('single pass, time zones, idempotent loads', { ...weak, perProcessorCutoff: true, idempotent: true });
run('tiered rules, tolerance 5, time zones, idempotent loads', { strategy: 'tiered', tolerance: 5, idempotent: true, perProcessorCutoff: true });
run('tiered rules, tolerance 5, files appended, UTC cut-off', { strategy: 'tiered', tolerance: 5, idempotent: false, perProcessorCutoff: false });
run('loose fuzzy, tolerance 1000, time zones, idempotent loads', { strategy: 'loose', tolerance: 1000, idempotent: true, perProcessorCutoff: true });
run('tiered rules, tolerance 1000, time zones, idempotent loads', { strategy: 'tiered', tolerance: 1000, idempotent: true, perProcessorCutoff: true });
