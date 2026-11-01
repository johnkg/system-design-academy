import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, RUN_SECONDS, type Params } from '../src/models/stripe-api.ts';

const off = { limiter: false, shedder: false, retry: 'none', idempotency: false } as const;
const runawayScript: Params = { incident: 'runawayScript', ...off };
const slowWorkers: Params = { incident: 'slowWorkers', ...off };
// What the page prints: percentages and loads to one decimal, doubled charges as a whole number.
const shown = (p: Params) => {
  const r = simulate(p);
  return { failed: (100 * r.failedShare).toFixed(1), chargesFailed: (100 * r.criticalFailedShare).toFixed(1), peak: r.peakLoad.toFixed(1), overloaded: r.overloadedSeconds, twice: Math.round(r.duplicateCharges) };
};

// The figures below are the ones the break-it lesson quotes.
test('a runaway script with no protection fails charges as often as anything else', () => {
  assert.deepEqual(shown(runawayScript), { failed: '41.1', chargesFailed: '41.1', peak: '5.6', overloaded: 30, twice: 0 });
});

test('the request rate limiter stops the script, apart from one second of burst', () => {
  assert.deepEqual(shown({ ...runawayScript, limiter: true }), { failed: '0.2', chargesFailed: '0.2', peak: '1.1', overloaded: 1, twice: 0 });
});

test('the load shedder keeps every charge working even though other requests still fail', () => {
  assert.deepEqual(shown({ ...runawayScript, shedder: true }), { failed: '31.8', chargesFailed: '0.0', peak: '0.7', overloaded: 0, twice: 0 });
});

test('retrying at once into slow workers triples the load and doubles some charges; never retrying does neither', () => {
  assert.deepEqual(shown({ ...slowWorkers, retry: 'immediate' }), { failed: '15.0', chargesFailed: '15.0', peak: '3.3', overloaded: 31, twice: 133 });
  assert.deepEqual(shown(slowWorkers), { failed: '16.7', chargesFailed: '16.7', peak: '1.5', overloaded: 30, twice: 0 });
});

test('idempotency keys remove the doubled charges but not the overload', () => {
  assert.deepEqual(shown({ ...slowWorkers, retry: 'immediate', idempotency: true }), { failed: '14.9', chargesFailed: '14.9', peak: '3.3', overloaded: 31, twice: 0 });
});

test('with keys and a shedder, charges survive and the workers stay under capacity', () => {
  assert.deepEqual(shown({ ...slowWorkers, retry: 'immediate', idempotency: true, shedder: true }), { failed: '17.3', chargesFailed: '0.0', peak: '0.9', overloaded: 0, twice: 0 });
});

test('without retries nothing is ever charged twice, with or without keys', () => {
  for (const idempotency of [false, true]) assert.equal(simulate({ ...runawayScript, idempotency }).duplicateCharges, 0);
});

test('backoff with jitter ramps up more slowly than retrying at once, but both reach the same plateau', () => {
  const at = (retry: 'immediate' | 'backoff') => simulate({ ...slowWorkers, retry }).loadBySecond;
  const immediate = at('immediate'), backoff = at('backoff');
  assert.equal(immediate.length, RUN_SECONDS);
  assert.ok(backoff[13] < immediate[13], 'a few seconds in, backoff is lighter');
  assert.equal(Math.max(...backoff).toFixed(1), Math.max(...immediate).toFixed(1));
});

test('the model is deterministic', () => {
  assert.deepEqual(simulate({ ...slowWorkers, retry: 'backoff' }), simulate({ ...slowWorkers, retry: 'backoff' }));
});
