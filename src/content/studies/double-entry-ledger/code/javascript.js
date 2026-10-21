// A double-entry ledger in JavaScript: immutable entries, balanced lines, idempotent posting,
// balances as a derived projection, a hot account split in shards, and corrections by reversal.
// Amounts are integer cents. A positive amount is a debit and a negative amount is a credit.

class Ledger {
  constructor() {
    this.entries = [];        // the journal: append only, never changed
    this.byKey = new Map();   // idempotency key -> entry
    this.balances = new Map(); // derived state, updated with each entry
  }

  post(key, lines, reverses = 0) {
    const sig = lines.map(([account, amount]) => `${account}:${amount}`).join(',');
    const seen = this.byKey.get(key);
    if (seen) { // a retry of something already posted
      if (seen.sig !== sig) throw new Error('key reused with different lines');
      return { entry: seen, duplicate: true };
    }
    if (lines.length < 2 || lines.some(([, amount]) => !Number.isInteger(amount) || amount === 0)) throw new Error('invalid lines');
    if (lines.reduce((sum, [, amount]) => sum + amount, 0) !== 0) throw new Error('unbalanced');
    const entry = Object.freeze({ seq: this.entries.length + 1, key, sig, lines: Object.freeze(lines), reverses });
    this.entries.push(entry);
    this.byKey.set(key, entry);
    for (const [account, amount] of lines) this.balances.set(account, (this.balances.get(account) ?? 0) + amount);
    return { entry, duplicate: false };
  }

  // A correction is a new entry with every line negated. The original stays in the journal.
  reverse(seq) {
    const original = this.entries[seq - 1];
    return this.post(`rev-${seq}`, original.lines.map(([account, amount]) => [account, -amount]), seq);
  }

  // Rebuild every balance from the journal alone, to check the derived state.
  replay() {
    const balances = new Map();
    for (const e of this.entries) for (const [account, amount] of e.lines) balances.set(account, (balances.get(account) ?? 0) + amount);
    return balances;
  }

  sumOf(prefix) { // a hot account is spread over sub-accounts such as fees#0 .. fees#7
    let total = 0;
    for (const [account, amount] of this.balances) if (account.startsWith(prefix)) total += amount;
    return total;
  }
}

const SEED = 2024;
const WALLETS = 4;
const OPENING_BALANCE = 1000000; // each wallet is funded from the bank
const PAYMENTS = 2000;
const MIN_AMOUNT = 100; // payment amounts are 100..2099
const AMOUNT_SPREAD = 2000;
const FEE_PCT = 3;
const FEE_SHARDS = 8; // the hot fees account is split over fees#0 .. fees#7
const RETRY_EVERY = 13; // every 13th payment is retried by the client
const BAD_EVERY = 17; // every 17th has a buggy unbalanced twin
const REFUND_EVERY = 29; // every 29th triggers a refund, sent twice

let seed = SEED;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

const ledger = new Ledger();
const count = { accepted: 0, duplicates: 0, unbalanced: 0, reversals: 0 };
const tally = (fn) => {
  try { const r = fn(); if (r.duplicate) count.duplicates++; else count.accepted++; return r; }
  catch (err) { if (err.message === 'unbalanced') { count.unbalanced++; return null; } throw err; }
};

for (let w = 1; w <= WALLETS; w++) tally(() => ledger.post(`init-${w}`, [['bank', OPENING_BALANCE], [`wallet-${w}`, -OPENING_BALANCE]]));
let last = 0;
for (let i = 0; i < PAYMENTS; i++) {
  const wallet = `wallet-${1 + random(WALLETS)}`, amount = MIN_AMOUNT + random(AMOUNT_SPREAD), fee = Math.floor(amount * FEE_PCT / 100);
  const lines = [[wallet, amount], ['merchant', -(amount - fee)], [`fees#${i % FEE_SHARDS}`, -fee]];
  const r = tally(() => ledger.post(`pay-${i}`, lines));
  if (r && !r.duplicate) last = r.entry.seq;
  if (i % RETRY_EVERY === 0) tally(() => ledger.post(`pay-${i}`, lines));                                  // the client retries
  if (i % BAD_EVERY === 0) tally(() => ledger.post(`bad-${i}`, [[wallet, amount], ['merchant', -amount + 1]])); // a bug: lines do not balance
  if (i % REFUND_EVERY === 0) { tally(() => ledger.reverse(last)); tally(() => ledger.reverse(last)); count.reversals++; } // refund, sent twice
}

const replayed = ledger.replay();
let trial = 0;
for (const amount of ledger.balances.values()) trial += amount;
const fees = Array.from({ length: FEE_SHARDS }, (_, k) => ledger.balances.get(`fees#${k}`) ?? 0);
console.log(`accepted ${count.accepted}, duplicates ignored ${count.duplicates}, rejected unbalanced ${count.unbalanced}, refunds ${count.reversals}`);
for (const a of ['bank', 'wallet-1', 'wallet-2', 'wallet-3', 'wallet-4', 'merchant']) console.log(`${a}: ${ledger.balances.get(a)}`);
console.log(`fees: ${ledger.sumOf('fees#')} over 8 shards, each between ${-Math.max(...fees)} and ${-Math.min(...fees)} in credits`);
const matches = [...replayed].every(([a, v]) => ledger.balances.get(a) === v) && replayed.size === ledger.balances.size;
console.log(`trial balance: ${trial}; replay matches balances: ${matches}`);
if (trial !== 0 || !matches || count.unbalanced === 0 || ledger.entries.length !== count.accepted) process.exit(1);
