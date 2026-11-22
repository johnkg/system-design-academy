# IDOR (broken object-level authorization) in a toy invoice API with 8 endpoints and 20 invoices owned by 4 users.
# The attacker, bob (user 2), is logged in correctly. He owns 5 invoices and tries to reach the other 15.
# What to look for: "logged in" is not "allowed to see this object"; random ids hide the objects only until one endpoint
# (a list, a search, a bulk export, a leaked link) shows an id; checking a few handlers leaves the others open; and
# checking every row after fetching all rows is safe but reads the whole table.
# Fixed data and a seeded integer generator: the output never changes.

BOB = 2
state = 777


def owner(i):
    return i % 4 + 1  # invoice i belongs to user (i mod 4) + 1


def nxt():
    global state
    state = (state * 48271) % 2147483647  # MINSTD: the same sequence in every language
    return state


def hex6():
    return format(nxt() % 16777216, "06x")


def make_ids(kind):
    global state
    if kind == "sequential":
        return [str(1001 + i) for i in range(20)]
    state = 777
    return [hex6() for _ in range(20)]


ENDPOINTS = [
    {"id": "E1", "kind": "id", "effect": "read"},      # GET /invoices/{id}
    {"id": "E2", "kind": "id", "effect": "change"},    # PUT /invoices/{id}
    {"id": "E3", "kind": "id", "effect": "delete"},    # DELETE /invoices/{id}
    {"id": "E4", "kind": "id", "effect": "read"},      # GET /invoices/{id}/pdf
    {"id": "E5", "kind": "list", "effect": "read"},    # GET /invoices (list)
    {"id": "E6", "kind": "list", "effect": "read"},    # GET /search?q=
    {"id": "E7", "kind": "id", "effect": "read"},      # POST /invoices/export {ids}
    {"id": "E8", "kind": "list", "effect": "read"},    # GET /users/{userId}/invoices
]
# Which endpoints verify that the invoice is bob's (or, for lists, scope the query to bob).
ALL = ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"]
CHECKED = {"none": [], "scoped-lists": ["E5", "E6", "E8"], "some": ["E1", "E2", "E3"], "central": ALL, "perrow": ALL}


def attack(auth, id_kind, leaked):
    invoice_ids = make_ids(id_kind)
    foreign = [x for i, x in enumerate(invoice_ids) if owner(i) != BOB]
    # Guessing: sequential ids are all guessable; for random ids bob tries 2000 random 6-digit hex values.
    if id_kind == "sequential":
        guessed = foreign
    else:
        tries = {hex6() for _ in range(2000)}
        guessed = [x for x in foreign if x in tries]
    candidates = set(guessed)
    if leaked:
        candidates.add(foreign[0])  # one id seen in a shared link or a log line

    def is_open(e):
        return e["id"] not in CHECKED[auth]

    for e in ENDPOINTS:
        if e["kind"] == "list" and is_open(e):
            candidates.update(foreign)  # lists show ids

    # What one endpoint lets bob reach: a list shows every foreign invoice when unchecked, an id endpoint takes any id he has.
    def reach(e):
        if not is_open(e):
            return []
        return foreign if e["kind"] == "list" else list(candidates)

    exposed = {e["id"]: len(reach(e)) for e in ENDPOINTS}

    def count(effect):
        return len({x for e in ENDPOINTS if e["effect"] == effect for x in reach(e)})

    return {"exposed": exposed, "read": count("read"), "change": count("change"), "del": count("delete"), "guessed_valid": len(guessed)}


print("bob owns 5 of 20 invoices; the other 15 belong to other users")
for auth in ["none", "scoped-lists", "some", "central", "perrow"]:
    for id_kind in ["sequential", "random"]:
        r = attack(auth, id_kind, False)
        per = " ".join(f"{e['id']} {r['exposed'][e['id']]}" for e in ENDPOINTS)
        print(f"{auth} + {id_kind} ids: read {r['read']}, changed {r['change']}, deleted {r['del']} of 15 | {per} | valid guesses {r['guessed_valid']}")
print("one foreign id leaks (a shared link or a log line), random ids:")
for auth in ["none", "scoped-lists", "some", "central", "perrow"]:
    r = attack(auth, "random", True)
    print(f"  {auth}: read {r['read']}, changed {r['change']}, deleted {r['del']} of 15")
print("cost of one list request by table size (own invoices are a quarter of the table):")
for n in [20, 1000, 100000]:
    print(f"  {n} invoices: scoped query reads {n // 4} rows and makes 1 policy call; fetch-all-then-check reads {n} rows and makes {n} policy calls")
