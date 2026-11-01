# A miniature of the migration in Notion's 2021 post "Herding elephants: Lessons learned from sharding Postgres at Notion",
# in Python (a teaching model, not Notion's code): route each workspace to a logical shard and a physical database,
# double-write through an audit log, backfill a snapshot without overwriting newer records, check with dark reads, then switch.
# Everything is deterministic, so every run prints the same thing. All numbers are made up for teaching.
import sys

LOGICAL_SHARDS = 12  # Notion has 480
DATABASES = 3  # Notion has 32, with 15 logical shards on each
LOST_EVENT = 2  # the catch-up script silently drops this audit event, so the checks have something to find


# 32-bit FNV-1a, used to turn a workspace id into a logical shard.
def fnv(text):
    h = 0x811C9DC5
    for b in text.encode():
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h


def shard_of(workspace):
    return fnv(workspace) % LOGICAL_SHARDS


def database_of(shard):
    return (shard * DATABASES) // LOGICAL_SHARDS


# The old monolith: "workspace/block" -> version of that block.
monolith = {"ws-ada/1": 1, "ws-ada/2": 1, "ws-ada/3": 1, "ws-bob/1": 1, "ws-bob/2": 1, "ws-bob/3": 1, "ws-cy/1": 1, "ws-cy/2": 1}
shards = {}  # the new databases, seen as one map
audit_log = []  # (key, version)


# While migrating, a write goes to the monolith (still the source of truth) and is recorded in the audit log.
def application_write(key):
    version = monolith.get(key, 0) + 1
    monolith[key] = version
    audit_log.append((key, version))


# Replaying an event only ever moves a version forward, so replaying the same event twice does no harm.
def replay(index):
    key, version = audit_log[index]
    shards[key] = max(shards.get(key, 0), version)


def dark_reads():
    differing = [key for key in sorted(monolith) if shards.get(key) != monolith[key]]
    detail = f" ({', '.join(differing)})" if differing else ""
    print(f"dark reads: compared {len(monolith)} rows, {len(differing)} differ{detail}")
    return len(differing)


print("--- routing: workspace id -> logical shard -> physical database")
for workspace in ["ws-ada", "ws-bob", "ws-cy"]:
    shard = shard_of(workspace)
    print(f"{workspace} -> schema{shard:03d} on database {database_of(shard)}")

print("--- migration")
snapshot = dict(monolith)  # the backfill copies from a snapshot taken now
for key in ["ws-ada/2", "ws-bob/4", "ws-cy/1"]:
    application_write(key)
print(f"writes during the migration: {len(audit_log)}, all recorded in the audit log")
replay(0)  # the catch-up script gets to the first event before the backfill reaches that row
copied = 0
skipped = 0
for key in sorted(snapshot):
    if shards.get(key, 0) >= snapshot[key]:
        skipped += 1  # a newer record is already there
    else:
        shards[key] = snapshot[key]
        copied += 1
print(f"backfill: copied {copied} rows, skipped {skipped} that already had a newer version")
replayed = 0
for i in range(1, len(audit_log)):
    if i == LOST_EVENT:
        continue
    replay(i)
    replayed += 1
print(f"catch-up: events replayed {replayed}, events lost 1")
before = dark_reads()
for i in range(len(audit_log)):  # the repair: replay the whole log
    replay(i)
after = dark_reads()

print("--- switch-over")
print("five-minute window: reads and writes now go to the new databases, the reverse audit log holds 0 events")
ok = copied == 7 and skipped == 1 and before == 1 and after == 0
print(f"checks {'passed' if ok else 'FAILED'}")
if not ok:
    sys.exit(1)
