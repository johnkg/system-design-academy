"""An LRU cache and a coalescing loader. Time is counted in whole ticks so every run prints the same."""
from collections import OrderedDict

CAPACITY = 3              # entries the LRU cache holds
LOAD_TICKS = 3            # a database load takes 3 ticks to finish
FIRST_TICK = 60           # the hot key has just expired at this tick
LAST_TICK = 64            # the demo stops after this tick
REQUESTS_PER_TICK = 5     # requests for the hot key in each tick


class LruCache:
    """Least recently used: an OrderedDict remembers order, so the first key is the oldest."""

    def __init__(self, capacity):
        self.capacity = capacity
        self.items = OrderedDict()

    def get(self, key):
        if key not in self.items:
            return None
        self.items.move_to_end(key)   # the key becomes the most recently used
        return self.items[key]

    def put(self, key, value):
        """Store a value. Returns the key it evicted, or None."""
        evicted = None
        if key in self.items:
            self.items.move_to_end(key)
        elif len(self.items) >= self.capacity:
            evicted, _ = self.items.popitem(last=False)
        self.items[key] = value
        return evicted

    def keys(self):
        return list(self.items)


# Part 1: LRU in action.
lru = LruCache(CAPACITY)
hits = misses = 0
for key in ["A", "B", "C", "A", "D", "B", "A", "E"]:
    if lru.get(key) is not None:
        hits += 1
        print(f"get {key}: hit")
        continue
    misses += 1
    evicted = lru.put(key, "value of " + key)
    print(f"get {key}: miss" + (f", evicts {evicted}" if evicted else ""))
print("oldest to newest: " + " ".join(lru.keys()))
print(f"hits {hits}, misses {misses}")


class Loader:
    """With coalescing on, requests for a key that is already being loaded join that load instead of starting their own."""

    def __init__(self, coalesce):
        self.cache = LruCache(CAPACITY)
        self.coalesce = coalesce
        self.in_flight = []   # database loads under way: (key, ready_at)
        self.db_loads = self.hits = self.joined = 0

    def finish_loads(self, now):
        for key, ready_at in self.in_flight:
            if ready_at <= now:
                self.cache.put(key, "fresh")
        self.in_flight = [load for load in self.in_flight if load[1] > now]

    def request(self, key, now):
        if self.cache.get(key) is not None:
            self.hits += 1
            return
        if self.coalesce and any(k == key for k, _ in self.in_flight):
            self.joined += 1
            return
        self.db_loads += 1
        self.in_flight.append((key, now + LOAD_TICKS))


# Part 2: the hot key has just expired and requests keep arriving.
for coalesce in [False, True]:
    loader = Loader(coalesce)
    total = 0
    for tick in range(FIRST_TICK, LAST_TICK + 1):
        loader.finish_loads(tick)
        for _ in range(REQUESTS_PER_TICK):
            loader.request("home", tick)
            total += 1
    label = "on " if coalesce else "off"
    print(f"coalescing {label}: {total} requests, {loader.db_loads} database loads, {loader.joined} joined, {loader.hits} hits")
