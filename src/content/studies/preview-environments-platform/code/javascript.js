// A preview-environment controller, in JavaScript:
// one namespace per pull request, routing by subdomain, idle sleep, a time limit, a cap on running environments, and cleanup on merge.

const IDLE = 30, TTL = 200, MAX_RUNNING = 4; // ticks of silence before sleep, ticks of life, environments allowed to run at once

class Platform {
  constructor() {
    this.envs = [];                       // one entry per open pull request, in creation order
    this.log = [];
    this.stats = { opened: 0, served: 0, notFound: 0, coldStarts: 0, slept: 0, evicted: 0, merged: 0, expired: 0, peak: 0 };
  }
  find(pr) { return this.envs.find((e) => e.pr === pr); }
  running() { return this.envs.filter((e) => e.state === 'running'); }
  note(now, text) { this.log.push(`t=${now} ${text}`); }

  // Routing: "pr-104.preview.example.com" belongs to namespace "pr-104". Anything else is not ours.
  route(host) {
    const parts = host.split('.');
    return parts.length === 4 && parts[0].startsWith('pr-') && parts.slice(1).join('.') === 'preview.example.com' ? Number(parts[0].slice(3)) : -1;
  }

  makeRoom(now) { // the quota: at most MAX_RUNNING environments run, so the least recently used one goes to sleep
    while (this.running().length >= MAX_RUNNING) {
      const lru = this.running().reduce((a, b) => (b.lastHit < a.lastHit ? b : a));
      lru.state = 'sleeping'; this.stats.evicted++; this.note(now, `${lru.ns} put to sleep to make room`);
    }
  }
  open(pr, now) {
    if (this.find(pr)) return;
    this.makeRoom(now);
    this.envs.push({ pr, ns: `pr-${pr}`, state: 'running', created: now, lastHit: now });
    this.stats.opened++; this.note(now, `pr-${pr} created`);
  }
  hit(host, now) {
    const env = this.find(this.route(host));
    if (!env) { this.stats.notFound++; return; }
    if (env.state === 'sleeping') { this.makeRoom(now); env.state = 'running'; this.stats.coldStarts++; this.note(now, `${env.ns} woken by a request`); }
    env.lastHit = now; this.stats.served++;
  }
  merge(pr, now) {
    if (!this.find(pr)) return;
    this.envs = this.envs.filter((e) => e.pr !== pr); this.stats.merged++; this.note(now, `pr-${pr} merged and deleted`);
  }
  tick(now) { // the reaper: idle environments sleep, old ones are deleted
    for (const e of this.envs) if (e.state === 'running' && now - e.lastHit >= IDLE) { e.state = 'sleeping'; this.stats.slept++; this.note(now, `${e.ns} idle, asleep`); }
    for (const e of this.envs) if (now - e.created >= TTL) { this.stats.expired++; this.note(now, `${e.ns} reached its time limit, deleted`); }
    this.envs = this.envs.filter((e) => now - e.created < TTL);
    this.stats.peak = Math.max(this.stats.peak, this.running().length);
  }
}

const SEED = 7, TICKS = 400, FIRST_PR = 100, PRS = 10;
// Each tick draws 0..99: below 6 a PR opens, below 40 a preview is visited, below 43 a PR merges, below 45 a stray host is hit.
const OPEN_BELOW = 6, HIT_BELOW = 40, MERGE_BELOW = 43, STRAY_BELOW = 45;
let seed = SEED;
// Linear congruential generator (Numerical Recipes constants), high 16 bits.
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

const p = new Platform();
for (let t = 0; t < TICKS; t++) {
  const r = random(100), pr = FIRST_PR + random(PRS);
  if (r < OPEN_BELOW) p.open(pr, t);
  else if (r < HIT_BELOW) p.hit(`pr-${pr}.preview.example.com`, t);
  else if (r < MERGE_BELOW) p.merge(pr, t);
  else if (r < STRAY_BELOW) p.hit('www.example.com', t);
  p.tick(t);
  if (p.running().length > MAX_RUNNING) { console.log('quota broken'); process.exit(1); }
}
p.log.slice(0, 10).forEach((l) => console.log(l));
const s = p.stats;
console.log(`opened ${s.opened}, merged ${s.merged}, expired ${s.expired}, slept ${s.slept}, evicted ${s.evicted}, cold starts ${s.coldStarts}`);
console.log(`served ${s.served}, not found ${s.notFound}, peak running ${s.peak}, still open ${p.envs.length}`);
const names = new Set(p.envs.map((e) => e.ns));
console.log(`namespaces unique: ${names.size === p.envs.length}; all within time limit: ${p.envs.every((e) => TICKS - 1 - e.created < TTL)}`);
if (names.size !== p.envs.length || s.peak > MAX_RUNNING || s.opened !== s.merged + s.expired + p.envs.length) process.exit(1);
