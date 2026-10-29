# A miniature of three ideas from Cloudflare's Quicksilver posts, in Python (a teaching model, not Cloudflare's code):
# 1. a numbered log, so a replica can notice a missing entry and ask again from the last entry it applied,
# 2. a replica that keeps older versions of a key, so it can answer "what was the value as of log index N?",
# 3. a proxy that keeps a small window of the newest updates, so it never has to ask a replica that is behind it.
# Everything is deterministic, so every run prints the same thing.
import sys

# The log written at the top of the tree: (index, operation, key, value). Indexes go up by exactly one.
LOG = [
    (1, "SET", "a", 1), (2, "SET", "b", 1), (3, "SET", "a", 2), (4, "SET", "c", 1),
    (5, "DEL", "b", None), (6, "SET", "d", 1), (7, "SET", "b", 2), (8, "SET", "e", 1),
]
WINDOW = 3  # how many of the newest updates a proxy keeps


class Replica:
    def __init__(self, db_id):
        self.db_id = db_id
        self.last = 0  # index of the last entry applied
        self.current = {}  # key -> (index written, value); a value of None is a tombstone (the key was deleted)
        self.history = {}  # key -> older (index, value) versions, oldest first

    def apply(self, entry):
        index, op, key, value = entry
        if index != self.last + 1:
            return False  # a gap (or a repeat): refuse it
        if key in self.current:
            self.history.setdefault(key, []).append(self.current[key])
        self.current[key] = (index, value if op == "SET" else None)
        self.last = index
        return True

    # The value of a key as it was when the log was at `index`.
    def get_at(self, key, index):
        if key in self.current and self.current[key][0] <= index:
            return self.current[key][1]
        for written, value in reversed(self.history.get(key, [])):
            if written <= index:
                return value
        return None  # the key did not exist yet at that index


def handshake(client_db, server_db):
    return client_db == server_db


def show(value):
    return "not found" if value is None else str(value)


# 1. Replication with a numbered log.
replica = Replica("dns")
for entry in [LOG[0], LOG[1], LOG[2], LOG[4]]:  # entry 4 is lost on the way
    if not replica.apply(entry):
        print(f"replica at index {replica.last}: got entry {entry[0]} but expected {replica.last + 1}, asks again from index {replica.last}")
        break
for entry in LOG[replica.last:]:
    replica.apply(entry)
print(f"replica resynced and is now at index {replica.last}")
print(f"handshake with database page-rules: {'accepted' if handshake('dns', 'page-rules') else 'refused'}")
print(f"handshake with database dns: {'accepted' if handshake('dns', 'dns') else 'refused'}")

# 2. A proxy at index 5 asks a replica at index 8, which keeps older versions.
behind = Replica("dns")  # what a replica that had stopped at index 5 would answer
for entry in LOG[:5]:
    behind.apply(entry)
ok = True
for key in "abcde":
    answer = replica.get_at(key, 5)
    ok = ok and answer == behind.get_at(key, 5)
    print(f"read {key} as of index 5: {show(answer)} (the replica is at index {replica.last})")

# 3. A proxy at index 8 asks a replica that is still at index 5.
proxy_window = {}  # key -> (index, value) for the newest WINDOW updates
for index, op, key, value in LOG[-WINDOW:]:
    proxy_window[key] = (index, value if op == "SET" else None)
for key in "abcde":
    if key in proxy_window:
        answer, source = proxy_window[key][1], "window"
    else:
        answer, source = behind.get_at(key, 5), "replica at index 5"
    ok = ok and answer == replica.get_at(key, 8)
    print(f"proxy at index 8 reads {key}: {show(answer)} from the {source}")

print(f"log entries {len(LOG)}, checks {'passed' if ok and replica.last == 8 else 'FAILED'}")
if not ok:
    sys.exit(1)
