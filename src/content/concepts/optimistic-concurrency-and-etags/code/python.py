# Optimistic concurrency with ETags: a versioned in-memory store with a conditional update (If-Match),
# and a seeded interleaving of support agents doing read-modify-write on shared customer records.


class Store:
    def __init__(self, records, require_if_match):
        self.notes = [0] * records
        self.version = [0] * records
        self.require_if_match = require_if_match

    def etag(self, id):  # strong ETag derived from the row version
        return f'"v{self.version[id]}"'

    def get(self, id):
        return 200, self.etag(id), self.notes[id]

    # PUT with an optional If-Match header. Same effect as: UPDATE ... SET notes=?, version=version+1 WHERE id=? AND version=?
    def put(self, id, notes, if_match):
        if if_match is None and self.require_if_match:
            return 428  # Precondition Required
        if if_match is not None and if_match != self.etag(id):
            return 412  # Precondition Failed
        self.notes[id] = notes
        self.version[id] += 1
        return 200


SEED, AGENTS, RECORDS, EDITS_EACH = 7, 4, 2, 10
seed = SEED


def rand(n):
    """Linear congruential generator (Numerical Recipes constants), high 16 bits."""
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


# Each step, a random agent that still has work does one action: read a record, or write back its edit.
def run(use_if_match, agents, records, edits_each):
    global seed
    seed = SEED
    store = Store(records, False)
    a = [{"left": edits_each, "id": -1, "notes": 0, "etag": ""} for _ in range(agents)]
    saved = conflicts = 0
    while any(x["left"] > 0 for x in a):
        busy = [y for y in a if y["left"] > 0]
        x = busy[rand(len(busy))]
        if x["id"] < 0:  # read phase
            x["id"] = rand(records)
            _, x["etag"], x["notes"] = store.get(x["id"])
        else:  # write phase: add one note to what this agent saw
            status = store.put(x["id"], x["notes"] + 1, x["etag"] if use_if_match else None)
            if status == 200:
                saved += 1
                x["left"] -= 1
            else:
                conflicts += 1  # on 412 keep the edit and re-read
            x["id"] = -1
    final = sum(store.notes)
    return saved, final, saved - final, conflicts


none = run(False, AGENTS, RECORDS, EDITS_EACH)
occ = run(True, AGENTS, RECORDS, EDITS_EACH)
print(f"no check:   saved={none[0]} final={none[1]} lost={none[2]} conflicts={none[3]}")
print(f"if-match:   saved={occ[0]} final={occ[1]} lost={occ[2]} conflicts={occ[3]}")

strict = Store(1, True)
first = strict.get(0)[1]
print(f"PUT without If-Match: {strict.put(0, 1, None)}")
print(f"PUT with {first}: {strict.put(0, 1, first)}")
print(f"PUT with stale {first}: {strict.put(0, 2, first)}")

if occ[2] != 0 or occ[1] != AGENTS * EDITS_EACH:
    raise SystemExit("version check must not lose updates")
if none[2] <= 0:
    raise SystemExit("the unchecked run should lose updates")
