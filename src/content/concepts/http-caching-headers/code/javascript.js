// A tiny HTTP cache that applies Cache-Control and ETag rules to a scripted request sequence.
// Time is an integer number of seconds passed in by hand, so the output is deterministic.
import assert from "node:assert";

function parseCc(header) {
  const d = {};
  for (let part of header.split(",")) {
    part = part.trim();
    if (!part) continue;
    const i = part.indexOf("=");
    if (i < 0) d[part] = true;
    else d[part.slice(0, i)] = parseInt(part.slice(i + 1), 10);
  }
  return d;
}

class Origin {
  static CC = { "/app.js": "max-age=60, stale-while-revalidate=30", "/index.html": "no-cache",
    "/me": "no-store", "/app.3f9a.js": "max-age=31536000, immutable" };
  static CHANGES_AT = { "/app.js": 100, "/index.html": 110 }; // a deploy: version 1 becomes version 2
  requests = 0;

  version(url, now) {
    return now >= (Origin.CHANGES_AT[url] ?? 1e9) ? 2 : 1;
  }

  handle(url, now, ifNoneMatch) {
    this.requests++;
    const ver = this.version(url, now);
    const etag = `"v${ver}"`;
    if (ifNoneMatch === etag) return [304, Origin.CC[url], etag, null];
    return [200, Origin.CC[url], etag, ver];
  }
}

class Cache {
  store = {};
  constructor(origin) { this.origin = origin; }

  fetch(url, now, etag) {
    const [status, cc, newEtag, ver] = this.origin.handle(url, now, etag);
    if (status === 304) this.store[url].stored = now; // unchanged: keep the body, restart its age
    else if (!("no-store" in parseCc(cc))) this.store[url] = { cc, etag: newEtag, ver, stored: now }; // no-store: never write it
    return [status, ver];
  }

  get(url, now) {
    const e = this.store[url];
    if (!e) return ["miss", 0, this.fetch(url, now, null)[1]];
    const cc = parseCc(e.cc), age = now - e.stored;
    const life = "no-cache" in cc ? 0 : cc["max-age"] ?? 0;
    if (age < life) return ["hit", age, e.ver];
    if (!("no-cache" in cc) && age < life + (cc["stale-while-revalidate"] ?? 0)) {
      const staleVer = e.ver;
      this.fetch(url, now, e.etag); // background refresh, the caller does not wait
      return ["swr", age, staleVer];
    }
    const [status, ver] = this.fetch(url, now, e.etag);
    return status === 304 ? ["revalidated", 0, e.ver] : ["refetched", 0, ver];
  }
}

const SCRIPT = [[0, "/app.js"], [0, "/index.html"], [0, "/me"], [0, "/app.3f9a.js"], [30, "/app.js"], [40, "/me"],
  [50, "/index.html"], [61, "/app.js"], [80, "/me"], [100, "/app.js"], [120, "/index.html"],
  [121, "/app.js"], [130, "/app.js"], [150, "/index.html"], [200, "/app.3f9a.js"], [300, "/app.js"],
  [100000, "/app.3f9a.js"]];

const origin = new Origin();
const cache = new Cache(origin);
const counts = { hit: 0, swr: 0, revalidated: 0, refetched: 0, miss: 0 };
let staleViews = 0;
for (const [t, url] of SCRIPT) {
  const [outcome, age, ver] = cache.get(url, t);
  const stale = ver < origin.version(url, t);
  if (stale) staleViews++;
  counts[outcome]++;
  console.log(`t=${t} ${url} ${outcome} age=${age} v${ver}${stale ? " STALE" : ""}`);
}
console.log(`hit=${counts.hit} swr=${counts.swr} revalidated=${counts.revalidated} refetched=${counts.refetched} miss=${counts.miss} origin=${origin.requests} stale=${staleViews}`);

assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), SCRIPT.length);
assert.equal(origin.requests, counts.miss + counts.revalidated + counts.refetched + counts.swr);
assert.ok(!("/me" in cache.store) && counts.miss === 6); // three first loads plus the three later /me requests
assert.deepEqual([counts.hit, counts.swr, counts.revalidated, counts.refetched], [5, 2, 3, 1]);
assert.equal(staleViews, 2); // /app.js at t=100 (hit) and t=121 (swr) show v1 after the deploy
