// A polite crawl frontier in JavaScript:
// URLs are cleaned up so the same page is not fetched twice, and each site gets its own queue with a minimum gap between requests.

// Different spellings of one page become one string: host in lower case, no default port, no #fragment, no trailing slash.
function normalize(raw) {
  const u = new URL(raw);
  const path = u.pathname.replace(/\/+$/, '') || '/';
  return `${u.protocol}//${u.host}${path}${u.search}`;
}

class Frontier {
  constructor(gapSeconds) {
    this.gap = gapSeconds;
    this.seen = new Set(); // every URL ever added
    this.queues = new Map(); // host -> URLs waiting for that host
    this.nextAllowed = new Map(); // host -> the earliest time we may fetch from it again
  }

  add(raw) {
    const url = normalize(raw);
    if (this.seen.has(url)) return;
    this.seen.add(url);
    const host = new URL(url).host;
    if (!this.queues.has(host)) this.queues.set(host, []);
    this.queues.get(host).push(url);
  }

  // The next URL whose site is not being rested, or null if every site with work is waiting.
  next(now) {
    for (const [host, queue] of this.queues) {
      if (queue.length === 0 || (this.nextAllowed.get(host) ?? 0) > now) continue;
      this.nextAllowed.set(host, now + this.gap);
      this.queues.delete(host); this.queues.set(host, queue); // move this host to the back, so the others get a turn
      return queue.shift();
    }
    return null;
  }

  get pending() { return [...this.queues.values()].reduce((s, q) => s + q.length, 0); }
}

// A tiny pretend web: every page and the links found on it, written the messy way real pages write them.
const web = {
  'http://a.com/': ['http://a.com/p1', 'http://a.com/p2', 'HTTP://B.com:80/#top', 'http://c.com/'],
  'http://a.com/p1': ['http://a.com/', 'http://a.com/p2/', 'http://b.com/x'],
  'http://a.com/p2': ['http://a.com/p1#section', 'http://c.com/y'],
  'http://b.com/': ['http://a.com/', 'http://b.com/x', 'http://b.com/y'],
  'http://b.com/x': ['http://b.com/'],
  'http://b.com/y': ['http://b.com/x'],
  'http://c.com/': ['http://c.com/y', 'http://a.com/p1'],
  'http://c.com/y': [],
};

const GAP = 2; // seconds between requests to one site
const WORKERS = 2; // fetches that can run at the same moment
const MAX_SECONDS = 60; // stop the crawl after this long
const frontier = new Frontier(GAP);
frontier.add('http://a.com/');

const fetchedAt = new Map();
const lastTime = new Map();
let tooSoon = 0;
for (let t = 0; t < MAX_SECONDS && (frontier.pending > 0); t++) {
  for (let w = 0; w < WORKERS; w++) {
    const url = frontier.next(t);
    if (!url) break;
    if (fetchedAt.has(url)) process.exit(1); // a page fetched twice
    fetchedAt.set(url, t);
    const host = new URL(url).host;
    if (lastTime.has(host) && t - lastTime.get(host) < GAP) tooSoon++; // a site hit again too soon
    lastTime.set(host, t);
    console.log(`t=${String(t).padStart(2)}s  fetched ${url}`);
    (web[url] ?? []).forEach((link) => frontier.add(link)); // parse the page and queue its links
  }
}
console.log(`pages fetched: ${fetchedAt.size} of ${Object.keys(web).length}   requests sent too soon: ${tooSoon}`);
if (fetchedAt.size !== Object.keys(web).length || tooSoon > 0) process.exit(1);
