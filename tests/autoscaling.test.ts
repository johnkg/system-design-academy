import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTraffic, simulate, summarize, SIMULATED_MINUTES, TRAFFIC_SEED, type Params } from '../src/models/autoscaling.ts';

const traffic = makeTraffic(TRAFFIC_SEED);
const lastMinute = SIMULATED_MINUTES - 1;
// The page's default controls.
const defaults: Params = { policy: 'target', metric: 'rps', target: 60, warmup: 3, cooldown: 2, patient: true, min: 2, max: 30 };
const run = (overrides: Partial<Params> = {}) => {
  const result = simulate({ ...defaults, ...overrides }, traffic);
  return { ...summarize(result, SIMULATED_MINUTES), actions: result.actions[lastMinute], flaps: result.flaps[lastMinute], result };
};

test('traffic is seeded: the same seed replays the same day, a different seed does not', () => {
  assert.deepEqual(makeTraffic(TRAFFIC_SEED), traffic);
  assert.notDeepEqual(makeTraffic(TRAFFIC_SEED + 1), traffic);
  assert.equal(traffic.length, SIMULATED_MINUTES);
  assert.ok(traffic.every(Number.isInteger));
});

// The numbers below are the ones the lesson text quotes ("about 9 overloaded minutes", "roughly 100k dropped requests", ...).
test('default policy: a 3 minute warm-up leaves about 9 overloaded minutes and about 100k dropped requests', () => {
  const r = run();
  assert.equal(r.overloadedMinutes, 9);
  assert.ok(r.dropped > 95_000 && r.dropped < 105_000, `dropped ${r.dropped}`);
});

test('warm-up is what hurts: 0 minutes nearly removes the overload, 6 minutes makes it worse', () => {
  assert.equal(run({ warmup: 0 }).overloadedMinutes, 2);
  assert.equal(run({ warmup: 6 }).overloadedMinutes, 12);
});

test('scaling on CPU cannot see how big the spike is, so it drops about twice as many requests', () => {
  const rps = run().dropped; const cpu = run({ metric: 'cpu' }).dropped;
  assert.ok(cpu > 1.9 * rps && cpu < 2.3 * rps, `rps ${rps}, cpu ${cpu}`);
});

test('immediate scale-in with no cooldown chases the noise: more actions and flaps, but cheaper', () => {
  const patient = run(); const chasing = run({ patient: false, cooldown: 0 });
  assert.deepEqual([patient.actions, patient.flaps], [26, 3]);
  assert.deepEqual([chasing.actions, chasing.flaps], [35, 11]);
  assert.ok(chasing.cost < patient.cost, 'saves instance-minutes');
  assert.deepEqual([run({ patient: false, cooldown: 3 }).actions, run({ patient: false, cooldown: 3 }).flaps], [13, 3]);
});

test('scheduled policy is the cheapest run but is short of capacity for about 21 minutes', () => {
  const scheduled = run({ policy: 'scheduled' });
  assert.equal(scheduled.overloadedMinutes, 21);
  assert.ok(scheduled.cost < run().cost && scheduled.cost < run({ target: 30 }).cost);
});

test('a 30% target drops nothing but costs far more than the default', () => {
  const careful = run({ target: 30 });
  assert.equal(careful.dropped, 0);
  assert.ok(careful.cost > 1.7 * run().cost);
});

test('instance counts always stay between min and max, even when min is set above max', () => {
  for (const overrides of [{}, { min: 6, max: 6 }, { min: 20, max: 4 }, { policy: 'step' as const }]) {
    const p = { ...defaults, ...overrides }; const low = Math.min(p.min, p.max); const high = Math.max(p.min, p.max);
    const { ready, total } = simulate(p, traffic);
    assert.ok(ready.every((n) => n >= 0 && n <= high), JSON.stringify(overrides));
    assert.ok(total.every((n) => n >= low && n <= high), JSON.stringify(overrides));
  }
});

test('summarize totals only the minutes shown so far', () => {
  const { result } = run();
  assert.deepEqual(summarize(result, 0), { dropped: 0, cost: 0, overloadedMinutes: 0 });
  assert.ok(summarize(result, 40).dropped <= summarize(result, SIMULATED_MINUTES).dropped);
});
