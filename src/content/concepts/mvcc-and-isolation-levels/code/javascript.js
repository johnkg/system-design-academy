// A tiny MVCC store: versions carry xmin/xmax transaction ids, a snapshot decides visibility,
// commits use first-committer-wins, and an optional serializable check aborts "pivot" transactions.

import assert from "node:assert";

class Abort extends Error {}

class Txn {
  status = "active";
  cseq = 0;
  reads = new Set();
  writes = new Map();

  constructor(store, id, snap, serializable) {
    Object.assign(this, { store, id, snap, serializable });
  }

  get(key) {
    this.reads.add(key);
    if (this.writes.has(key)) return this.writes.get(key);
    for (const v of this.store.versions.get(key) ?? []) if (this.store.visible(v, this.snap)) return v.value;
    return null;
  }

  put(key, value) {
    this.writes.set(key, value); // buffered until commit
  }

  concurrentWith(other) {
    if (other === this || other.status === "aborted") return false;
    return other.status === "active" || other.cseq > this.snap;
  }

  commit() {
    const s = this.store;
    for (const key of this.writes.keys()) { // first committer wins
      for (const v of s.versions.get(key) ?? []) {
        if ((s.commitSeq.get(v.xmin) ?? 0) > this.snap) {
          this.status = "aborted";
          throw new Abort("write-write conflict on " + key);
        }
      }
    }
    if (this.serializable) { // simplified SSI: abort a txn with both an in and an out rw-dependency
      const peers = s.txns.filter((u) => this.concurrentWith(u));
      const outDep = peers.some((u) => [...this.reads].some((k) => u.writes.has(k))); // I read what a peer writes
      const inDep = peers.some((u) => [...u.reads].some((k) => this.writes.has(k))); // a peer read what I write
      if (outDep && inDep) {
        this.status = "aborted";
        throw new Abort("pivot of a read-write dependency cycle");
      }
    }
    this.cseq = ++s.clock;
    s.commitSeq.set(this.id, this.cseq);
    for (const [key, value] of this.writes) {
      if (!s.versions.has(key)) s.versions.set(key, []);
      const chain = s.versions.get(key);
      for (const v of chain) if (v.xmax === 0) v.xmax = this.id; // the old version is deleted by this txn
      chain.push({ value, xmin: this.id, xmax: 0 });
    }
    this.status = "committed";
  }
}

class Store {
  clock = 0;
  nextId = 1;
  versions = new Map();
  commitSeq = new Map();
  txns = [];

  constructor(initial) {
    const setup = this.begin();
    for (const [k, v] of Object.entries(initial)) setup.put(k, v);
    setup.commit();
  }

  begin(serializable = false) {
    const t = new Txn(this, this.nextId++, this.clock, serializable);
    this.txns.push(t);
    return t;
  }

  visible(v, snap) {
    const c = this.commitSeq.get(v.xmin) ?? 0;
    const d = v.xmax === 0 ? 0 : this.commitSeq.get(v.xmax) ?? 0;
    return c > 0 && c <= snap && !(d > 0 && d <= snap);
  }

  chain(key) {
    return this.versions.get(key).map((v) => `(${v.value},xmin=${v.xmin},xmax=${v.xmax})`).join(" ");
  }
}

function tryCommit(name, t) {
  try {
    t.commit();
    console.log(`${name} commit: ok`);
  } catch (e) {
    if (!(e instanceof Abort)) throw e;
    console.log(`${name} commit: abort (${e.message})`);
  }
}

function writeSkew(serializable) {
  const db = new Store({ alice: 1, bob: 1 }); // two doctors on call; the rule: at least one must stay
  const t1 = db.begin(serializable);
  const t2 = db.begin(serializable);
  for (const [name, t, me] of [["T1", t1, "alice"], ["T2", t2, "bob"]]) {
    const n = t.get("alice") + t.get("bob");
    console.log(`${name} sees ${n} on call` + (n >= 2 ? `, ${me} goes off call` : ""));
    if (n >= 2) t.put(me, 0);
  }
  tryCommit("T1", t1);
  tryCommit("T2", t2);
  const check = db.begin();
  const onCall = check.get("alice") + check.get("bob");
  console.log(`on call now: ${onCall}; alice ${db.chain("alice")}`);
  return onCall;
}

console.log("== write skew under snapshot isolation ==");
assert.strictEqual(writeSkew(false), 0); // the invariant is broken: nobody is on call
console.log("== write skew with the serializable check ==");
assert.strictEqual(writeSkew(true), 1); // one transaction was aborted, the rule holds

console.log("== lost update under snapshot isolation ==");
const db = new Store({ acct: 100 });
const t1 = db.begin();
const t2 = db.begin();
t1.put("acct", t1.get("acct") + 50);
t2.put("acct", t2.get("acct") - 30);
tryCommit("T1", t1);
tryCommit("T2", t2);
const balance = db.begin().get("acct");
console.log(`balance: ${balance}; acct ${db.chain("acct")}`);
assert.ok(balance === 150 && t2.status === "aborted"); // the aborted T2 retries and gets 120
