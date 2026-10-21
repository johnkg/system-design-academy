// A caching DNS resolver in JavaScript: the first lookup walks the hierarchy, later ones hit the cache until the TTL ends.
// A fake clock moved by hand keeps the output deterministic.

let now = 0; // seconds
const TTL = 300; // seconds a record may be cached

// What the authoritative server knows
const authoritative = new Map([["shop.example.com", { ip: "203.0.113.7", ttl: TTL }]]);

class Resolver {
  #cache = new Map(); // name -> { ip, expiresAt }

  resolve(name) {
    const cached = this.#cache.get(name);
    if (cached && cached.expiresAt > now) return { ip: cached.ip, source: "cache" };

    // Cache miss: ask the root, then the TLD server, then the authoritative server
    const hops = ["root", ".com", "example.com"];
    const record = authoritative.get(name);
    this.#cache.set(name, { ip: record.ip, expiresAt: now + record.ttl });
    return { ip: record.ip, source: `network (${hops.join(" -> ")})` };
  }
}

const resolver = new Resolver();
const lookup = () => {
  const { ip, source } = resolver.resolve("shop.example.com");
  console.log(`t=${String(now).padStart(3)} s: ${ip} from ${source}`);
};

lookup();      // cold: three round trips
now = 10;
lookup();      // within the TTL: cache
now = TTL - 1;
lookup();      // still within the TTL

// The operator moves the site to a new server, but caches keep the old answer until the TTL ends
authoritative.set("shop.example.com", { ip: "198.51.100.9", ttl: TTL });
now = TTL - 1;
lookup();      // still the OLD address
now = TTL + 1;
lookup();      // TTL over: the new address
