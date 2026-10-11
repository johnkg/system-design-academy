# A tiny MVCC store: versions carry xmin/xmax transaction ids, a snapshot decides visibility,
# commits use first-committer-wins, and an optional serializable check aborts "pivot" transactions.

class Abort(Exception):
    pass


class Txn:
    def __init__(self, store, txid, snap, serializable):
        self.store, self.id, self.snap, self.serializable = store, txid, snap, serializable
        self.reads, self.writes = set(), {}
        self.status, self.cseq = "active", 0

    def get(self, key):
        self.reads.add(key)
        if key in self.writes:
            return self.writes[key]
        for v in self.store.versions.get(key, []):
            if self.store.visible(v, self.snap):
                return v[0]
        return None

    def put(self, key, value):
        self.writes[key] = value  # buffered until commit

    def concurrent_with(self, other):
        if other is self or other.status == "aborted":
            return False
        return other.status == "active" or other.cseq > self.snap

    def commit(self):
        s = self.store
        for key in self.writes:  # first committer wins
            for v in s.versions.get(key, []):
                if s.commit_seq.get(v[1], 0) > self.snap:
                    self.status = "aborted"
                    raise Abort("write-write conflict on " + key)
        if self.serializable:  # simplified SSI: abort a txn with both an in and an out rw-dependency
            peers = [u for u in s.txns if self.concurrent_with(u)]
            out_dep = any(self.reads & set(u.writes) for u in peers)  # I read what a peer writes
            in_dep = any(u.reads & set(self.writes) for u in peers)   # a peer read what I write
            if out_dep and in_dep:
                self.status = "aborted"
                raise Abort("pivot of a read-write dependency cycle")
        s.clock += 1
        s.commit_seq[self.id] = self.cseq = s.clock
        for key, value in self.writes.items():
            chain = s.versions.setdefault(key, [])
            for v in chain:
                if v[2] == 0:
                    v[2] = self.id  # the old version is deleted by this txn
            chain.append([value, self.id, 0])
        self.status = "committed"


class Store:
    def __init__(self, initial):
        self.clock, self.next_id, self.versions, self.commit_seq, self.txns = 0, 1, {}, {}, []
        setup = self.begin()
        for k, v in initial.items():
            setup.put(k, v)
        setup.commit()

    def begin(self, serializable=False):
        t = Txn(self, self.next_id, self.clock, serializable)
        self.next_id += 1
        self.txns.append(t)
        return t

    def visible(self, v, snap):
        created = 0 < self.commit_seq.get(v[1], 0) <= snap
        deleted = v[2] != 0 and 0 < self.commit_seq.get(v[2], 0) <= snap
        return created and not deleted

    def chain(self, key):
        return " ".join(f"({v[0]},xmin={v[1]},xmax={v[2]})" for v in self.versions[key])


def try_commit(name, t):
    try:
        t.commit()
        print(f"{name} commit: ok")
    except Abort as e:
        print(f"{name} commit: abort ({e})")


def write_skew(serializable):
    db = Store({"alice": 1, "bob": 1})  # two doctors on call; the rule: at least one must stay
    t1, t2 = db.begin(serializable), db.begin(serializable)
    for name, t, me in (("T1", t1, "alice"), ("T2", t2, "bob")):
        n = t.get("alice") + t.get("bob")
        print(f"{name} sees {n} on call" + (f", {me} goes off call" if n >= 2 else ""))
        if n >= 2:
            t.put(me, 0)
    try_commit("T1", t1)
    try_commit("T2", t2)
    check = db.begin()
    on_call = check.get("alice") + check.get("bob")
    print(f"on call now: {on_call}; alice {db.chain('alice')}")
    return on_call


print("== write skew under snapshot isolation ==")
assert write_skew(False) == 0  # the invariant is broken: nobody is on call
print("== write skew with the serializable check ==")
assert write_skew(True) == 1  # one transaction was aborted, the rule holds

print("== lost update under snapshot isolation ==")
db = Store({"acct": 100})
t1, t2 = db.begin(), db.begin()
t1.put("acct", t1.get("acct") + 50)
t2.put("acct", t2.get("acct") - 30)
try_commit("T1", t1)
try_commit("T2", t2)
balance = db.begin().get("acct")
print(f"balance: {balance}; acct {db.chain('acct')}")
assert balance == 150 and t2.status == "aborted"  # the aborted T2 retries and gets 120
