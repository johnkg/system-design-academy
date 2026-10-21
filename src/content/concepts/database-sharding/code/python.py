# Sharding in Python: route keys to shards by hash, and measure what resharding costs.


def fnv_hash(text):  # FNV-1a: a small, stable hash (the same result in every language)
    h = 2166136261
    for ch in text:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def shard_for(user_id, shard_count):
    return fnv_hash(f"user:{user_id}") % shard_count


class ShardedStore:
    def __init__(self, shard_count):
        self.shards = [{} for _ in range(shard_count)]  # one small "database" per shard

    def put(self, user_id, user):
        self.shards[shard_for(user_id, len(self.shards))][user_id] = user

    def get(self, user_id):  # touches ONE shard
        return self.shards[shard_for(user_id, len(self.shards))].get(user_id)

    def count_where(self, predicate):  # no shard key in the query: ask every shard and merge (scatter-gather)
        return sum(sum(1 for u in shard.values() if predicate(u)) for shard in self.shards)


SHARDS, NEW_SHARDS, USERS = 3, 4, 1000
FR_EVERY = 4  # every 4th user lives in FR

store = ShardedStore(SHARDS)
for id in range(1, USERS + 1):
    store.put(id, {"id": id, "country": "FR" if id % FR_EVERY == 0 else "US"})

print("rows per shard:", ", ".join(str(len(s)) for s in store.shards))
print("user 42 is on shard", shard_for(42, SHARDS), "->", store.get(42)["country"])
print("users in FR (scatter-gather):", store.count_where(lambda u: u["country"] == "FR"))

moved = sum(1 for id in range(1, USERS + 1) if shard_for(id, SHARDS) != shard_for(id, NEW_SHARDS))
print(f"going from 3 to 4 shards moves {moved * 100 / USERS:g}% of keys")
