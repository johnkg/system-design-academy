import { test } from 'node:test';
import assert from 'node:assert/strict';
import { N_SEC, simulate, summarise, type Params } from '../src/models/load-shedding.ts';

// The page's default controls: no protection, a 15 second spike at 3x, a 2 second client timeout.
const defaults: Params = { policy: 'fifo', retry: 'none', rejectPct: 5, mult: 3, spikeLen: 15, timeoutSec: 2, limit: 50, deadline: false };
const run = (overrides: Partial<Params> = {}) => {
  const params = { ...defaults, ...overrides };
  const sim = simulate(params);
  return { ...summarise(sim, params, N_SEC), recoverySec: sim.rec };
};
const near = (actual: number, expected: number, tolerance: number, what: string) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: expected ${expected} ± ${tolerance}, got ${actual}`);

// The figures below are the ones the lesson text quotes ("falls from 60 to about 19 req/s", "8,400 requests wasted", ...).
test('no protection: the server stays busy but useful work collapses and recovery takes over a minute', () => {
  const r = run();
  assert.equal(r.busy, 1);
  near(r.goodRate, 19, 1, 'goodput');
  near(r.wasted, 8400, 50, 'wasted work');
  assert.equal(r.recoverySec, 72);
});

test('a static limit below capacity x timeout holds goodput and wastes nothing; a limit above it collapses', () => {
  const safe = run({ policy: 'bounded' });
  near(safe.goodRate, 80, 1, 'goodput at limit 50');
  near(safe.latMs, 610, 5, 'latency at limit 50');
  assert.equal(safe.wasted, 0);
  assert.equal(safe.recoverySec, 0);
  const tooLoose = run({ policy: 'bounded', limit: 400 });
  near(tooLoose.goodRate, 18, 1, 'goodput at limit 400');
  assert.equal(tooLoose.wasted, 1663);
});

test('adaptive limit handles the same overload without a hand-picked number', () => {
  const r = run({ policy: 'adaptive' });
  near(r.goodRate, 81, 1, 'goodput');
  near(r.latMs, 368, 5, 'latency');
  assert.equal(r.wasted, 0);
});

test('retries make rejections expensive: cheap at the edge, ruinous deep in the app', () => {
  const atOnce = { policy: 'bounded' as const, retry: 'naive' as const };
  near(run(atOnce).goodRate, 61, 1, 'goodput, rejection 5%');
  near(run({ ...atOnce, rejectPct: 1 }).goodRate, 90, 1, 'goodput, rejection 1%');
  near(run({ ...atOnce, rejectPct: 20 }).goodRate, 2, 1, 'goodput, rejection 20%');
});

test('LIFO keeps the same goodput as the static limit at a fraction of the latency', () => {
  const fifo = run({ policy: 'bounded' }); const lifo = run({ policy: 'lifo' });
  near(lifo.goodRate, fifo.goodRate, 1, 'goodput');
  near(lifo.latMs, 100, 5, 'LIFO latency');
  assert.ok(fifo.latMs > 5 * lifo.latMs);
});

test('priority shedding protects critical traffic until the critical class alone fills capacity', () => {
  near(run({ policy: 'priority', mult: 5 }).critShare, 0.71, 0.01, 'critical share at a 5x spike');
  assert.ok(run({ policy: 'priority' }).critShare > run().critShare, 'better than no protection');
});

test('skipping requests whose caller has gone restores goodput but leaves latency near the timeout', () => {
  const r = run({ deadline: true });
  near(r.goodRate, 100, 1, 'goodput');
  near(r.latMs, 1800, 50, 'latency');
});

test('the simulation is deterministic', () => {
  assert.deepEqual(simulate(defaults), simulate(defaults));
});
