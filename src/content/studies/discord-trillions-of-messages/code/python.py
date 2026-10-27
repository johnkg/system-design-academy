# Two techniques from Discord's message storage story, as a small model in Python (not Discord's code):
# 1. Time-bucketed partitions: messages are stored under (channel, bucket), so no partition grows for ever, and a
#    "latest messages" query walks buckets from newest to oldest.
# 2. Request coalescing: readers of the same row who arrive while a read is already running join it instead of
#    starting their own, and routing by channel sends them all to the same service instance.
# Time is simulated (days for buckets, milliseconds for reads), so every run prints the same thing.
import sys

DAY_MS = 86400000
BUCKET_DAYS = 10  # the window Discord described in 2017 for keeping partitions under 100 MB
BUCKET_MS = BUCKET_DAYS * DAY_MS
NOW_DAY = 99


def bucket_of(ts):
    return ts // BUCKET_MS


channels = [
    {"name": "busy-announcements", "created_day": 0, "every": 6 * 3600000, "from": 40 * DAY_MS},  # a message every 6 hours since day 40
    {"name": "quiet-friends", "created_day": 5, "days": [12, 33, 71]},  # three messages in all
]

# The store: "channel:bucket" -> message timestamps, oldest first.
store = {}


def put(channel, ts):
    store.setdefault(f"{channel}:{bucket_of(ts)}", []).append(ts)


for c in channels:
    if "days" in c:
        for d in c["days"]:
            put(c["name"], d * DAY_MS)
    else:
        for ts in range(c["from"], NOW_DAY * DAY_MS, c["every"]):
            put(c["name"], ts)


# The newest `limit` messages: start in the current bucket, go back until enough are found or the channel's first bucket is passed.
def latest(c, limit):
    found = 0
    partitions = 0
    empty = 0
    b = bucket_of(NOW_DAY * DAY_MS)
    while b >= bucket_of(c["created_day"] * DAY_MS) and found < limit:
        rows = store.get(f"{c['name']}:{b}", [])
        partitions += 1
        if not rows:
            empty += 1
        found += min(len(rows), limit - found)
        b -= 1
    return found, partitions, empty


print(f"bucket window {BUCKET_DAYS} days, today is day {NOW_DAY} (bucket {bucket_of(NOW_DAY * DAY_MS)})")
for c in channels:
    size = max((len(rows) for key, rows in store.items() if key.startswith(c["name"] + ":")), default=0)
    found, partitions, empty = latest(c, 25)
    print(f"{c['name']}: largest partition {size} messages; latest 25 -> found {found}, read {partitions} partitions ({empty} empty)")

# Request coalescing. Eight readers ask for the same row; one database read takes 20 ms.
DB_MS = 20
INSTANCES = 3
arrivals = [0, 4, 9, 15, 22, 30, 41, 55]  # ms at which readers of the channel's newest row arrive


def hash_of(s):
    h = 7
    for ch in s:
        h = (h * 31 + ord(ch)) % 1000003
    return h


def database_reads(route, coalesce):
    running = {}  # "instance:row" -> time the read in progress finishes
    reads = 0
    for i, t in enumerate(arrivals):
        key = f"{route(i)}:busy-announcements:{bucket_of(NOW_DAY * DAY_MS)}"
        if coalesce and running.get(key, -1) > t:
            continue  # join the read in progress
        reads += 1
        running[key] = t + DB_MS
    return reads


def by_channel(i):
    return hash_of("busy-announcements") % INSTANCES  # same channel, same instance


def any_instance(i):
    return i % INSTANCES  # readers spread round robin


print(f"{len(arrivals)} readers of one row, database read {DB_MS} ms, {INSTANCES} service instances")
print(f"  no coalescing: {database_reads(any_instance, False)} database reads")
print(f"  coalescing, readers spread over instances: {database_reads(any_instance, True)} database reads")
print(f"  coalescing, routed by channel to instance {by_channel(0)}: {database_reads(by_channel, True)} database reads")

if database_reads(by_channel, True) >= database_reads(any_instance, True):
    sys.exit(1)
