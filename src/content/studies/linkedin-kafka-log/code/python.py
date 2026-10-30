# Three ideas from LinkedIn's 2014 post on Kafka, as a small model in Python (not LinkedIn's or Kafka's code):
# 1. A topic is a set of append-only logs (partitions). A key picks the partition and each record gets an offset.
# 2. Consumers share one log. Each keeps its own position, commits it now and then, and a replacement resumes from the commit.
# 3. A follower copy lags the leader. Consumers only see records every copy has, and the acknowledgement mode decides
#    what the producer was promised before the leader is lost.
# Everything is deterministic, so every run prints the same thing.
import sys

PARTITIONS = 3


def hash_of(key):
    h = 7
    for ch in key:
        h = (h * 31 + ord(ch)) % 1000003
    return h


# 1. Keys, partitions and offsets.
logs = [[] for _ in range(PARTITIONS)]
sends = ['ann', 'bob', 'hal', 'ann', 'jo', 'bob', 'ann', 'hal']
for key in sends:
    logs[hash_of(key) % PARTITIONS].append(key)
print(f"{len(sends)} records over {PARTITIONS} partitions")
for p, log in enumerate(logs):
    print(f"  partition {p}: offsets 0..{len(log) - 1} hold [{', '.join(log)}]")
ann_partitions = {p for p, log in enumerate(logs) if 'ann' in log}
print(f"  every record for key ann is in {len(ann_partitions)} partition")

# 2. One shared log, two consumers with their own positions, and a crash.
shared = [f"r{i}" for i in range(10)]
COMMIT_EVERY = 4


def consume(start, up_to, crash_after):
    seen = []
    committed = start
    for offset in range(start, up_to):
        if len(seen) == crash_after:
            break
        seen.append(offset)
        if (offset + 1) % COMMIT_EVERY == 0:
            committed = offset + 1
    return seen, committed


reporting, _ = consume(0, len(shared), float('inf'))
worker, worker_committed = consume(0, len(shared), 6)  # processes offsets 0..5, then crashes
replacement, _ = consume(worker_committed, len(shared), float('inf'))
again = [o for o in worker if o in replacement]
print(f"log of {len(shared)} records, stored once for both consumers")
print(f"  reporting job read {len(reporting)} records, offsets {reporting[0]}..{reporting[-1]}")
print(f"  worker crashed after offset {worker[-1]} with offset {worker_committed} committed")
print(f"  replacement starts at offset {replacement[0]} and sees offset {', '.join(map(str, again))} a second time")

# 3. A leader with 10 records, a follower that has fetched 7, and a lost leader.
leader, follower = 10, 7
visible = min(leader, follower)
print(f"leader holds {leader} records, follower holds {follower}, consumers can read offsets 0..{visible - 1}")
for mode in ['leader only', 'all in-sync copies']:
    acknowledged = leader if mode == 'leader only' else follower
    lost = max(0, acknowledged - follower)
    print(f"  ack = {mode}: producer told {acknowledged} are safe, leader lost, {lost} acknowledged records gone")

if len(ann_partitions) != 1 or len(again) != 2 or visible != 7:
    sys.exit(1)
