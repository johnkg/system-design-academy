# A caching DNS resolver in Python: the first lookup walks the hierarchy, later ones hit the cache until the TTL ends.
# A fake clock moved by hand keeps the output deterministic.

now = 0  # seconds
TTL = 300  # seconds a record may be cached

# What the authoritative server knows
authoritative = {"shop.example.com": {"ip": "203.0.113.7", "ttl": TTL}}


class Resolver:
    def __init__(self):
        self._cache = {}  # name -> (ip, expires_at)

    def resolve(self, name):
        cached = self._cache.get(name)
        if cached and cached[1] > now:
            return cached[0], "cache"

        # Cache miss: ask the root, then the TLD server, then the authoritative server
        hops = ["root", ".com", "example.com"]
        record = authoritative[name]
        self._cache[name] = (record["ip"], now + record["ttl"])
        return record["ip"], f"network ({' -> '.join(hops)})"


resolver = Resolver()


def lookup():
    ip, source = resolver.resolve("shop.example.com")
    print(f"t={now:>3} s: {ip} from {source}")


lookup()  # cold: three round trips
now = 10
lookup()  # within the TTL: cache
now = TTL - 1
lookup()  # still within the TTL

# The operator moves the site to a new server, but caches keep the old answer until the TTL ends
authoritative["shop.example.com"] = {"ip": "198.51.100.9", "ttl": TTL}
now = TTL - 1
lookup()  # still the OLD address
now = TTL + 1
lookup()  # TTL over: the new address
