# The core of an event streaming platform, in Python:
# keys pick a partition, an idempotent producer survives lost acknowledgements without duplicates,
# a consumer group resumes from committed offsets after a crash, and compaction keeps the latest value per key.
import sys


def fnv(s):
    h = 2166136261
    for c in s:
        h = ((h ^ ord(c)) * 16777619) & 0xFFFFFFFF
    return h


SEED, EVENTS, KEYS, PARTITIONS, LOSS_PERCENT = 7, 40, 7, 3, 20
COMMIT_EVERY, CRASH_AFTER = 4, 11  # the consumer commits every 4 records and crashes after 11
seed = SEED


def roll():  # 0..99, deterministic
    """Linear congruential generator (Numerical Recipes constants), high 16 bits."""
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % 100


class Partition:
    def __init__(self):
        self.log = []
        self.last_seq = {}  # the latest sequence number seen from each producer

    def append(self, producer_id, seq, key, value, idempotent):
        if idempotent:
            last = self.last_seq.get(producer_id, -1)
            if seq <= last:
                return 'duplicate'      # a retry of something already stored: acknowledge it, store nothing
            if seq > last + 1:
                return 'out of order'   # a gap: refuse, so the producer must resend in order
            self.last_seq[producer_id] = seq
        self.log.append((key, value))
        return 'appended'


def produce(idempotent):
    """One producer sends 40 events. Every request or acknowledgement is lost 20% of the time, and the producer then retries."""
    global seed
    seed = SEED
    parts = [Partition() for _ in range(PARTITIONS)]
    next_seq = [0] * PARTITIONS
    retries = 0
    for i in range(EVENTS):
        key = f'user-{i % KEYS}'
        p = fnv(key) % PARTITIONS
        seq = next_seq[p]
        next_seq[p] += 1
        while True:
            if roll() < LOSS_PERCENT:   # the request never arrived
                retries += 1
                continue
            parts[p].append(1, seq, key, i, idempotent)
            if roll() < LOSS_PERCENT:   # it was stored, but the acknowledgement was lost
                retries += 1
                continue
            break
    return parts, retries, sum(len(x.log) for x in parts)


_, plain_retries, plain_total = produce(False)
print(f'without idempotence: {plain_total} records stored for 40 sent, {plain_total - EVENTS} duplicates, {plain_retries} retries')
parts, retries, total = produce(True)
print(f'with idempotence: {total} records stored for 40 sent, {total - EVENTS} duplicates, {retries} retries')
print('partition sizes: ' + ' '.join(str(len(x.log)) for x in parts))


def ordered(log):  # every key's values must be in the order they were sent
    seen = {}
    for key, value in log:
        if value <= seen.get(key, -1):
            return False
        seen[key] = value
    return True


in_order = all(ordered(x.log) for x in parts)

# A consumer group: member b owns partition 1 and commits after each batch of 4. It crashes after processing 11 records.
log1 = parts[1].log
crash_at = min(CRASH_AFTER, len(log1))
committed = crash_at // COMMIT_EVERY * COMMIT_EVERY
reread = len(log1[committed:])  # member a takes over and starts from the committed offset
twice = crash_at - committed
print(f'group: b processed {crash_at} records of partition 1 and committed {committed}; a resumed at {committed} and read {reread}, so {twice} were processed twice')


def compact(log):
    """Compaction keeps only the newest record for each key, in log order."""
    last_at = {key: i for i, (key, _) in enumerate(log)}
    return [r for i, r in enumerate(log) if last_at[r[0]] == i]


kept = compact(parts[2].log)
print(f'compaction of partition 2: {len(parts[2].log)} records -> {len(kept)}, kept ' + ' '.join(f'{k}={v}' for k, v in kept))

ok = total == EVENTS and plain_total > EVENTS and in_order and twice == 3 and len({k for k, _ in kept}) == len(kept)
print(f'all invariants hold: {"true" if ok else "false"}')
if not ok:
    sys.exit(1)
