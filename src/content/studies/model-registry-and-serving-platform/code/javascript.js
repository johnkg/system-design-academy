// A model registry in JavaScript: immutable checksummed versions, gated promotion with approval,
// rollback, a sticky canary traffic split, and the scale-from-zero arithmetic.

// 32-bit FNV-1a hash, used here as the checksum of the weights and as the traffic-split hash.
const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
const checksum = (weights) => fnv(weights).toString(16).padStart(8, '0');

class Registry {
  constructor() { this.versions = []; }

  // Publishing the same bytes again returns the existing version, so a retried upload creates no duplicate.
  publish(weights, author) {
    const sum = checksum(weights);
    const found = this.versions.find((v) => v.sum === sum);
    if (found) return found;
    const v = { n: this.versions.length + 1, weights, sum, author, stage: 'none', evals: null };
    this.versions.push(v);
    return v;
  }

  // The eval gate: accuracy (per mille) must not drop more than 5 below production, and p95 latency must stay at or below 120 ms.
  stage(n, evals) {
    const v = this.versions[n - 1], prod = this.production();
    if (checksum(v.weights) !== v.sum) return `v${n} refused: checksum mismatch`;
    if (evals.p95 > 120) return `v${n} blocked: p95 ${evals.p95} ms is over 120 ms`;
    if (prod && evals.acc < prod.evals.acc - 5) return `v${n} blocked: accuracy ${evals.acc} is below production`;
    v.evals = evals; v.stage = 'staging';
    return `v${n} is in staging`;
  }

  // Production needs a passed staging gate and an approver who is not the author.
  promote(n, approver) {
    const v = this.versions[n - 1];
    if (v.stage !== 'staging') return `v${n} refused: not in staging`;
    if (approver === v.author) return `v${n} refused: the author cannot approve`;
    const prod = this.production();
    if (prod) prod.stage = 'archived';
    v.stage = 'production';
    return `v${n} is in production, approved by ${approver}`;
  }

  production() { return this.versions.find((v) => v.stage === 'production'); }

  // Rollback is a pointer move to the newest archived version: nothing is rebuilt or copied.
  rollback() {
    const prev = [...this.versions].reverse().find((v) => v.stage === 'archived');
    this.production().stage = 'rolled-back'; prev.stage = 'production';
    return `rolled back to v${prev.n}`;
  }
}

const reg = new Registry();
const v1 = reg.publish('weights-alpha', 'ana'), v2 = reg.publish('weights-beta', 'ana'), v3 = reg.publish('weights-gamma', 'ana');
console.log(`published v1=${v1.sum} v2=${v2.sum} v3=${v3.sum}; same bytes again gives v${reg.publish('weights-beta', 'ana').n}`);
console.log(reg.stage(1, { acc: 912, p95: 80 }), '|', reg.promote(1, 'bob'));
console.log(reg.stage(2, { acc: 925, p95: 95 }), '|', reg.promote(2, 'ana'), '|', reg.promote(2, 'bob'));
console.log(reg.stage(3, { acc: 931, p95: 160 }));
console.log(`tampered copy of v2 passes the checksum: ${checksum('weights-beta!') === v2.sum}`);

// A request id always lands on the same side, and raising the canary share only moves requests onto the canary.
const toCanary = (id, pct) => fnv(`req-${id}`) % 100 < pct;
let at10 = 0, at25 = 0, sticky = true, nested = true;
for (let i = 0; i < 10000; i++) {
  const a = toCanary(i, 10), b = toCanary(i, 25);
  if (a) at10++; if (b) at25++;
  if (a !== toCanary(i, 10)) sticky = false;
  if (a && !b) nested = false;
}
console.log(`canary share: ${at10} of 10000 at 10%, ${at25} at 25%; sticky ${sticky}; nested ${nested}`);

// Scale from zero: a cold replica pays 6 s of start-up plus the weight download. Replicas follow the queue at 8 requests each.
const coldStart = (sizeMb, mbPerSec) => 6 + Math.ceil(sizeMb / mbPerSec);
const replicas = (queue) => Math.ceil(queue / 8);
console.log(`cold start for 14000 MB: ${coldStart(14000, 1000)} s from the network, ${coldStart(14000, 5000)} s from a local cache; replicas for queue 0, 5, 50: ${[0, 5, 50].map(replicas).join(', ')}`);

console.log(reg.rollback());
if (reg.production().n !== 1 || at10 < 800 || at10 > 1200 || !sticky || !nested || checksum('weights-beta!') === v2.sum) process.exit(1);
