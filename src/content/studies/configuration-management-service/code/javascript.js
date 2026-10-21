// A configuration service in JavaScript: schema check at publish, staged rollout with a health gate,
// automatic rollback, and clients that keep a last-known-good copy when a fetch fails or is damaged.
const MIN_TIMEOUT_MS = 50; // schema limits
const MAX_TIMEOUT_MS = 5000;
const MAX_RETRIES = 5;
const CLIENTS = 1000;
const ERROR_LIMIT = 10; // failed clients a stage may have before rollback

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; };
const flat = (c) => `${c.timeout_ms}|${c.retries}|${c.mode}`; // canonical text, used for the checksum

function validate(c) { // the schema: type and range for every key
  if (!Number.isInteger(c.timeout_ms) || c.timeout_ms < MIN_TIMEOUT_MS || c.timeout_ms > MAX_TIMEOUT_MS) return 'timeout_ms must be 50..5000';
  if (!Number.isInteger(c.retries) || c.retries < 0 || c.retries > MAX_RETRIES) return 'retries must be 0..5';
  if (c.mode !== 'fast' && c.mode !== 'safe') return 'mode must be fast or safe';
  return 'ok';
}

class ConfigService {
  constructor() { this.versions = [null]; this.stable = 0; this.candidate = 0; this.pct = 0; this.down = false; }
  publish(cfg) {
    const why = validate(cfg);
    if (why !== 'ok') return { ok: false, why };
    this.versions.push(cfg);
    return { ok: true, version: this.versions.length - 1 };
  }
  fetch(clientId) { // a client in the first pct buckets gets the candidate, the rest get the stable version
    if (this.down) return null;
    const v = hash(clientId) % 100 < this.pct ? this.candidate : this.stable;
    const cfg = this.versions[v];
    return { version: v, cfg: { ...cfg }, sum: hash(flat(cfg)) };
  }
}

class Client {
  constructor(id) { this.id = id; this.version = 0; this.cfg = null; }
  poll(service, damage = false) {
    const r = service.fetch(this.id);
    if (!r) return 'kept';
    if (damage) r.cfg.timeout_ms += 1; // simulate a corrupted payload
    if (hash(flat(r.cfg)) !== r.sum || validate(r.cfg) !== 'ok') return 'kept'; // last-known-good stays
    this.version = r.version; this.cfg = r.cfg;
    return 'applied';
  }
  failing() { return this.cfg !== null && this.cfg.timeout_ms < 100; } // too short a timeout fails every call
}

function rollout(service, clients, version, stages, limit) {
  service.candidate = version;
  for (const pct of stages) {
    service.pct = pct;
    clients.forEach((c) => c.poll(service));
    const errors = clients.filter((c) => c.failing()).length;
    console.log(`  v${version} at ${pct}%: ${clients.filter((c) => c.version === version).length} clients, ${errors} failing`);
    if (errors > limit) {
      service.pct = 0; clients.forEach((c) => c.poll(service));
      console.log(`  rolled back, ${clients.filter((c) => c.failing()).length} failing`);
      return false;
    }
  }
  service.stable = version; service.pct = 0;
  clients.forEach((c) => c.poll(service));
  return true;
}

const show = (r) => (r.ok ? `ok, version ${r.version}` : `rejected, ${r.why}`);
const svc = new ConfigService();
const clients = Array.from({ length: CLIENTS }, (_, i) => new Client(`c${i}`));
console.log('publish v1:', show(svc.publish({ timeout_ms: 800, retries: 2, mode: 'safe' })));
svc.stable = 1; clients.forEach((c) => c.poll(svc));
console.log('publish v2:', show(svc.publish({ timeout_ms: 500, retries: 3, mode: 'fast' })));
console.log('publish bad:', show(svc.publish({ timeout_ms: 900, retries: 9, mode: 'fast' })));
console.log('publish v3:', show(svc.publish({ timeout_ms: 60, retries: 1, mode: 'fast' })));
const STAGES = [5, 25, 100]; // percent of clients at each step
const ok2 = rollout(svc, clients, 2, STAGES, ERROR_LIMIT);
const ok3 = rollout(svc, clients, 3, STAGES, ERROR_LIMIT);
const onV2 = clients.filter((c) => c.version === 2).length;

svc.down = true; // the service is unreachable, so every client keeps what it has
const kept = clients.filter((c) => c.poll(svc) === 'kept').length;
svc.down = false;
const damaged = clients[7].poll(svc, true);
console.log(`outage: ${kept} clients kept their copy; damaged payload: ${damaged}, still v${clients[7].version}`);
console.log(`rollout v2: ${ok2}, rollout v3: ${ok3}, clients on v2: ${onV2}`);
if (!ok2 || ok3 || onV2 !== CLIENTS || kept !== CLIENTS || damaged !== 'kept') process.exit(1);
