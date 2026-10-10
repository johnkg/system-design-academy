# A Kafka-style partitioned log in Python:
# keys pick a partition, each partition is an append-only log with a leader and followers, and a leader crash shows what each acks setting loses.
import sys


def fnv(s):  # FNV-1a, a stable hash
    h = 2166136261
    for c in s:
        h = ((h ^ ord(c)) * 16777619) & 0xFFFFFFFF
    return h


def partition_for(key, count):
    return fnv(key) % count


# ---- 1. Keys decide the partition, so one key's events stay in order ----
parts = [[] for _ in range(4)]
for n in range(5):
    for u in range(12):
        key = f'user-{u}'
        parts[partition_for(key, 4)].append({'key': key, 'n': n})


def is_in_order(log):
    last = {}
    ok_all = True
    for e in log:
        ok = last.get(e['key'], -1) < e['n']
        last[e['key']] = e['n']
        if not ok:
            ok_all = False
            break
    return ok_all


in_order = all(is_in_order(log) for log in parts)
print(f"partition sizes: {', '.join(str(len(l)) for l in parts)}; every key in order: {str(in_order).lower()}")


# ---- 2. One partition with three replicas: the leader appends, followers copy ----
class Partition:
    def __init__(self, replicas):
        self.logs = [[] for _ in range(replicas)]
        self.alive = [True] * replicas
        self.leader = 0

    def append(self, id, idempotent):
        log = self.logs[self.leader]
        if idempotent and id in log:  # a broker remembers each producer's last sequence number; "in" stands in
            return
        log.append(id)

    def fetch(self):  # followers catch up to the leader
        for r, log in enumerate(self.logs):
            if r != self.leader and self.alive[r]:
                log[:] = self.logs[self.leader]

    def crash(self):
        self.alive[self.leader] = False
        self.leader = -1

    def elect(self):  # the first in-sync replica takes over; the others truncate to its log
        self.leader = self.alive.index(True) if True in self.alive else -1


def run(acks, idempotent):
    p = Partition(3)
    acked = []
    for id in range(20):
        if id == 14:
            p.crash()  # the leader dies while the producer is writing
        if p.leader < 0:
            if acks == 0 and id < 16:  # fire and forget: nobody tells the producer, and the message goes nowhere
                acked.append(id)
                continue
            p.elect()  # acks 1 or all: an error, a metadata refresh, and a retry on the new leader
            p.fetch()
        p.append(id, idempotent)
        if acks == 'all' or id % 4 == 3:
            p.fetch()  # acks=all waits for the followers, otherwise they copy in batches
        if id == 9 and acks != 0:
            p.append(id, idempotent)  # the ack was lost on the network, so the producer retries
        acked.append(id)
    kept = p.logs[p.leader]
    lost = [id for id in acked if id not in kept]
    return {'acked': len(acked), 'kept': len(kept), 'lost': lost, 'dups': len(kept) - len(set(kept)), 'log': kept}


def show(label, r):
    print(f"{label}: acked {r['acked']}, in log {r['kept']}, acked but lost [{' '.join(map(str, r['lost']))}], duplicates {r['dups']}")


r0, r1, r_all, r_idem = run(0, False), run(1, False), run('all', False), run('all', True)
show('acks=0          ', r0)
show('acks=1          ', r1)
show('acks=all        ', r_all)
show('acks=all + idem ', r_idem)


# ---- 3. A consumer group member: the committed offset decides what happens after a crash ----
def consume(log, commit_first):
    committed = 0
    processed = []
    batch = log[committed:committed + 5]
    if commit_first:
        committed += len(batch)  # commit, then process
    processed.extend(batch[:3])  # crash after 3 messages
    rest = log[committed:]  # the restarted consumer resumes at the committed offset
    processed.extend(rest)
    missing = len([id for id in log if id not in processed])
    return {'missing': missing, 'repeated': len(processed) - len(set(processed))}


before, after = consume(r_idem['log'], True), consume(r_idem['log'], False)
print(f"commit before processing: {before['missing']} missing, {before['repeated']} repeated")
print(f"commit after processing:  {after['missing']} missing, {after['repeated']} repeated")

ok = (in_order and len(r_all['lost']) == 0 and r_idem['dups'] == 0 and len(r_idem['log']) == 20
      and len(r1['lost']) > 0 and len(r0['lost']) > len(r1['lost']) and r_all['dups'] == 1
      and before['missing'] == 2 and after['missing'] == 0 and after['repeated'] == 3)
if not ok:
    sys.exit(1)
