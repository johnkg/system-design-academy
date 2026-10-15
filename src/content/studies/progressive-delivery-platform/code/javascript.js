// A progressive rollout in JavaScript: regions go one after another (waves), each wave grows the new version in stages,
// and every stage compares the new version's error rate with the old version's, running side by side, using a one-sided z-test.

const STAGES = [1, 10, 50]; // percent of a region's traffic on the new version; after the last stage the region is promoted to 100%
const REGIONS = [{ name: 'sa', requests: 20000 }, { name: 'eu', requests: 60000 }, { name: 'us', requests: 120000 }];
const MIN_CANARY = 300;          // fewer requests than this prove nothing, so the bake time is extended
const Z_LIMIT = 2.33;            // one-sided, about a 1% chance of a false alarm per check
const TOTAL = REGIONS.reduce((s, r) => s + r.requests, 0);

let seed = 7;
const chance = (per10000) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % 10000 < per10000; };
const errors = (n, rate) => { let e = 0; for (let i = 0; i < n; i++) if (chance(rate)) e++; return e; };

// Prints hundredths as text, such as -118 -> -1.18, so every language shows the same digits.
const fmt2 = (h) => `${h < 0 ? '-' : ''}${Math.floor(Math.abs(h) / 100)}.${String(Math.abs(h) % 100).padStart(2, '0')}`;

// z statistic with a pooled error rate: how many standard errors the canary is above the baseline
function zScore(ec, nc, eb, nb) {
  const p = (ec + eb) / (nc + nb);
  const se = Math.sqrt(p * (1 - p) * (1 / nc + 1 / nb));
  return se === 0 ? 0 : (ec / nc - eb / nb) / se;
}

function rollout(name, canaryRate) {
  const baseRate = 100; // the old version fails 1% of requests (rates are per 10,000)
  let exposed = 0, bakes = 0, steps = 0;
  console.log(`release ${name} (real error rate ${canaryRate / 100}%)`);
  for (const region of REGIONS) {
    for (const pct of STAGES) {
      let nc = Math.floor((region.requests * pct) / 100), mult = 1;
      while (nc * mult < MIN_CANARY) { mult *= 2; bakes++; } // wait longer until there is enough traffic
      nc *= mult;
      const nb = region.requests * mult - nc;
      const ec = errors(nc, canaryRate), eb = errors(nb, baseRate);
      const z = zScore(ec, nc, eb, nb);
      const bad = z > Z_LIMIT;
      exposed += nc; steps++;
      console.log(`  ${region.name} ${pct}%: ${nc} canary requests, ${ec} errors, z=${fmt2(Math.floor(z * 100))} -> ${bad ? 'ROLL BACK' : 'ok'}`);
      if (bad) return { done: false, exposed, steps, bakes };
    }
  }
  return { done: true, exposed, steps, bakes };
}

const good = rollout('v2', 100);
const bad = rollout('v3', 200);
const share = (bad.exposed * 100) / TOTAL;
console.log(`v2 finished: ${good.done}, v3 finished: ${bad.done}`);
console.log(`v3 was seen by ${bad.exposed} of ${TOTAL} requests (${fmt2(Math.floor(share * 100))}%) before the rollback, ${bad.steps} checks`);
if (!good.done || bad.done || bad.exposed > TOTAL / 50 || bad.steps !== 2) process.exit(1);
