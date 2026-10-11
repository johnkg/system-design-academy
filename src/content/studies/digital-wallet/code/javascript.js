// A cross-shard wallet transfer in JavaScript:
// every shard applies each operation once (keyed by transfer id), and a durable transfer record lets a crashed transfer be finished, never repeated or lost.

const SHARDS = 4, ACCOUNTS = 8, START = 100;
const shardOf = (account) => account % SHARDS;

class Shard {
  constructor() { this.balance = new Map(); this.applied = new Map(); }
  // Add delta to an account exactly once per operation id. Repeating the id returns the first answer. A balance never goes below zero.
  apply(op, account, delta) {
    if (this.applied.has(op)) return this.applied.get(op);
    const ok = this.balance.get(account) + delta >= 0;
    if (ok) this.balance.set(account, this.balance.get(account) + delta);
    this.applied.set(op, ok);
    return ok;
  }
}

const makeShards = () => Array.from({ length: SHARDS }, (_, s) => {
  const shard = new Shard();
  for (let a = s; a < ACCOUNTS; a += SHARDS) shard.balance.set(a, START);
  return shard;
});
const total = (shards) => shards.reduce((sum, s) => sum + [...s.balance.values()].reduce((x, y) => x + y, 0), 0);

// The naive way: debit on one shard, then credit on another, with nothing recorded in between.
function naive(transfers) {
  const shards = makeShards(); const times = new Map();
  for (const t of transfers) {
    for (let run = 0; run < (t.again ? 2 : 1); run++) {            // a client that timed out sends it again
      if (!shards[shardOf(t.from)].apply(`${t.id}:${run}:d`, t.from, -t.amt)) break;
      times.set(t.id, (times.get(t.id) || 0) + 1);
      if (t.crash && run === 0) break;                              // the process dies before the credit
      shards[shardOf(t.to)].apply(`${t.id}:${run}:c`, t.to, t.amt);
    }
  }
  return { sum: total(shards), twice: [...times.values()].filter((n) => n > 1).length };
}

class Wallet {
  constructor() { this.shards = makeShards(); this.log = new Map(); }
  transfer(t) {
    let rec = this.log.get(t.id);
    if (!rec) { rec = { ...t, state: 'INIT' }; this.log.set(t.id, rec); }   // the intent is saved first
    if (rec.state === 'INIT') rec.state = this.shards[shardOf(rec.from)].apply(`${t.id}:d`, rec.from, -rec.amt) ? 'DEBITED' : 'REJECTED';
    if (rec.state === 'DEBITED' && t.crash) return;                            // crash: the money is "in flight", recorded in the log
    if (rec.state === 'DEBITED') { this.shards[shardOf(rec.to)].apply(`${t.id}:c`, rec.to, rec.amt); rec.state = 'DONE'; }
  }
  inFlight() { return [...this.log.values()].filter((r) => r.state === 'DEBITED').reduce((s, r) => s + r.amt, 0); }
  recover() { for (const r of this.log.values()) this.transfer({ ...r, crash: false }); }
  count(state) { return [...this.log.values()].filter((r) => r.state === state).length; }
}

let seed = 7;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };
const transfers = Array.from({ length: 24 }, (_, id) => {
  const from = random(ACCOUNTS);
  return { id, from, to: (from + 1 + random(ACCOUNTS - 1)) % ACCOUNTS, amt: 20 + random(80), crash: id % 5 === 2, again: id % 4 === 1 };
});

const bad = naive(transfers);
console.log(`naive debit then credit: total ${ACCOUNTS * START} -> ${bad.sum}, ${ACCOUNTS * START - bad.sum} lost, ${bad.twice} transfers charged twice`);

const wallet = new Wallet();
for (const t of transfers) { wallet.transfer(t); if (t.again) wallet.transfer(t); }   // repeats are ignored
const stuck = wallet.count('DEBITED');
console.log(`ledger after crashes: balances ${total(wallet.shards)} + in flight ${wallet.inFlight()} = ${total(wallet.shards) + wallet.inFlight()}, ${stuck} transfers waiting`);
wallet.recover();
console.log(`ledger after recovery: balances ${total(wallet.shards)}, in flight ${wallet.inFlight()}, done ${wallet.count('DONE')}, rejected ${wallet.count('REJECTED')}`);

const negative = wallet.shards.some((s) => [...s.balance.values()].some((b) => b < 0));
if (total(wallet.shards) !== ACCOUNTS * START || wallet.inFlight() !== 0 || negative || stuck === 0 || bad.sum >= ACCOUNTS * START) process.exit(1);
