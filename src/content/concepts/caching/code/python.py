# Caching in Python: an LRU cache with cache-aside reads.
from collections import OrderedDict


class LruCache:
    def __init__(self, max_size):
        self._max = max_size
        self._entries = OrderedDict()  # remembers insertion order, so the first key is the least recently used

    def get(self, key):
        if key not in self._entries:
            return None
        self._entries.move_to_end(key)  # mark as most recently used
        return self._entries[key]

    def set(self, key, value):
        if key in self._entries:
            del self._entries[key]
        elif len(self._entries) >= self._max:
            oldest = next(iter(self._entries))
            del self._entries[oldest]
            print(f"  evicted {oldest}")
        self._entries[key] = value

    def delete(self, key):  # explicit invalidation
        self._entries.pop(key, None)


class Database:
    def __init__(self):
        self.reads = 0

    def load(self, id):
        self.reads += 1
        return f"product-{id}"


database = Database()
cache = LruCache(2)
hits = 0


def get_product(id):  # cache-aside: check the cache, fall back to the database, then fill
    global hits
    cached = cache.get(id)
    if cached is not None:
        hits += 1
        return cached
    row = database.load(id)
    cache.set(id, row)
    return row


for id in [1, 2, 1, 3, 1, 2]:
    get_product(id)
print(f"hits: {hits}, database reads: {database.reads}")  # hits: 2, database reads: 4
