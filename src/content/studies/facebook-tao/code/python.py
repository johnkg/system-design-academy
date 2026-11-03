# A miniature of the TAO data model and request path from Facebook's "TAO: The power of the graph" (2013), in Python
# (a teaching model, not Facebook's code): typed objects and typed, timed associations, automatic inverse edges, point, range and
# count queries, and a follower cache in front of a leader cache in front of the database (MySQL's role), where a write travels
# through the leader and every cache on the way updates from the reply. Everything is deterministic.

SHARDS = 4
INVERSE = {"friend": "friend", "like": "liked_by", "liked_by": "like"}


def shard_of(obj_id):  # every object and every association list of an id lives on one shard
    return obj_id % SHARDS


db = {"objects": {}, "lists": {}, "reads": 0}  # the persistent store
leader = {"objects": {}, "lists": {}}  # regional cache that talks to the database
follower = {"objects": {}, "lists": {}}  # cache that clients talk to
served = ""  # which tier answered the last read


def list_key(id1, kind):
    return f"{id1}:{kind}"


def tier_read(kind, key, from_db):  # follower, then leader, then database; fill the caches on the way back
    global served
    if key in follower[kind]:
        served = "follower"
        return follower[kind][key]
    if key in leader[kind]:
        served = "leader"
        follower[kind][key] = leader[kind][key]
        return follower[kind][key]
    db["reads"] += 1
    served = "database"
    value = from_db()
    leader[kind][key] = value
    follower[kind][key] = value
    return value


def object_create(obj_id, kind, fields):
    obj = {"id": obj_id, "type": kind, **fields}
    db["objects"][obj_id] = obj
    leader["objects"][obj_id] = obj
    follower["objects"][obj_id] = obj


def object_get(obj_id):
    return tier_read("objects", obj_id, lambda: db["objects"][obj_id])


def assoc_range(id1, kind, limit=None):
    items = tier_read("lists", list_key(id1, kind), lambda: db["lists"].get(list_key(id1, kind), []))
    return items if limit is None else items[:limit]


def write_list(key, update):  # the write goes follower -> leader -> database; each tier updates from the reply
    nxt = update(db["lists"].get(key, []))
    db["lists"][key] = leader["lists"][key] = follower["lists"][key] = nxt


def assoc_add(id1, kind, id2, time):
    def add(a, t, b):
        write_list(list_key(a, t), lambda lst: sorted([{"id2": b, "time": time}] + [e for e in lst if e["id2"] != b], key=lambda e: -e["time"]))

    add(id1, kind, id2)
    add(id2, INVERSE[kind], id1)  # the inverse edge is created automatically


def assoc_delete(id1, kind, id2):
    def delete(a, t, b):
        write_list(list_key(a, t), lambda lst: [e for e in lst if e["id2"] != b])

    delete(id1, kind, id2)
    delete(id2, INVERSE[kind], id1)


def count(id1, kind):  # TAO keeps a count so this is constant time; here it is the list length
    return len(assoc_range(id1, kind))


def point(id1, kind, id2):
    return any(e["id2"] == id2 for e in assoc_range(id1, kind))


def names(lst):
    return ", ".join(f"{object_get(e['id2'])['name']}@{e['time']}" for e in lst) or "none"


def show(label, id1, kind):
    lst = assoc_range(id1, kind, 10)
    by = served  # names() reads objects and would change `served`
    print(f"{label}: {names(lst)} (served by the {by})")


object_create(1, "user", {"name": "Alice"})
object_create(2, "user", {"name": "Bob"})
object_create(3, "user", {"name": "Carol"})
object_create(4, "photo", {"name": "beach.jpg"})
print("shards: " + ", ".join(f"{object_get(i)['name']} -> shard {shard_of(i)}" for i in [1, 2, 3, 4]))

assoc_add(1, "friend", 2, 10)
assoc_add(1, "friend", 3, 20)
assoc_add(3, "like", 4, 30)
# Start with cold caches, as after a restart, to show where the reads come from.
for tier in (leader, follower):
    tier["lists"].clear()

show("Alice's friends, newest first", 1, "friend")
show("Alice's friends again", 1, "friend")
follower["lists"].clear()  # a different follower that has not seen this list yet
show("Alice's friends, empty follower cache", 1, "friend")
print(f"Alice has {count(1, 'friend')} friends")
print(f"is Bob a friend of Alice? {str(point(1, 'friend', 2)).lower()}; is Alice a friend of Bob (the inverse edge)? {str(point(2, 'friend', 1)).lower()}")
show("who liked beach.jpg", 4, "liked_by")

object_create(5, "user", {"name": "Dave"})
assoc_add(1, "friend", 5, 40)
show("after a write, Alice's friends", 1, "friend")
assoc_delete(1, "friend", 2)
print(f"after unfriending Bob: Alice has {count(1, 'friend')} friends, Bob has {count(2, 'friend')}")
print(f"database reads in total: {db['reads']}")
