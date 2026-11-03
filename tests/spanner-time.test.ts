import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, type Params } from '../src/models/spanner-time.ts';

// The page's default controls: a quiet day (epsilon 4 ms), clocks 6 ms apart, a 10 ms Paxos commit, commit wait on.
const defaults: Params = { commitWait: true, epsilonMs: 4, clockGapMs: 6, paxosMs: 10 };
const run = (overrides: Partial<Params> = {}) => simulate({ ...defaults, ...overrides });
const shown = (overrides: Partial<Params> = {}) => {
  const r = run(overrides);
  return { latency: r.writeLatencyMs, wait: r.commitWaitMs, first: r.firstTimestampMs, second: r.secondTimestampMs, margin: r.marginMs, ordered: r.orderPreserved, bound: r.boundHolds };
};

// The figures below are the ones the break-it lesson quotes, in the order it quotes them (each step adds to the one before).
const spike = { epsilonMs: 12 };
const skipped = { ...spike, clockGapMs: 20, commitWait: false };
const waiting = { ...skipped, commitWait: true };
const dishonest = { ...waiting, clockGapMs: 30 };

test('on a quiet day the commit wait is hidden inside the Paxos commit and order is preserved', () => {
  assert.deepEqual(shown(), { latency: 10, wait: 8, first: 7, second: 11, margin: 4, ordered: true, bound: true });
});

test('a TrueTime spike makes the commit wait longer than the Paxos commit, so writes get slower, but order is preserved', () => {
  assert.deepEqual(shown(spike), { latency: 24, wait: 24, first: 15, second: 33, margin: 18, ordered: true, bound: true });
});

test('skipping the wait with clocks 20 ms apart orders a later transaction before an earlier one', () => {
  assert.deepEqual(shown(skipped), { latency: 10, wait: 24, first: 22, second: 12, margin: -10, ordered: false, bound: true });
});

test('waiting out the uncertainty restores the order, at the cost of write latency', () => {
  assert.deepEqual(shown(waiting), { latency: 24, wait: 24, first: 22, second: 26, margin: 4, ordered: true, bound: true });
});

test('commit wait cannot rescue a bound that is dishonest: clocks further apart than twice epsilon still invert the order', () => {
  assert.deepEqual(shown(dishonest), { latency: 24, wait: 24, first: 27, second: 21, margin: -6, ordered: false, bound: false });
});

test('whenever the bound holds and the wait is on, the order is preserved, for every uncertainty and gap tested', () => {
  for (let epsilonMs = 1; epsilonMs <= 20; epsilonMs++) for (let clockGapMs = 0; clockGapMs < 2 * epsilonMs; clockGapMs++) {
    const r = run({ epsilonMs, clockGapMs });
    assert.ok(r.boundHolds && r.orderPreserved, `epsilon ${epsilonMs}, gap ${clockGapMs}`);
  }
});

test('the wait costs nothing while twice epsilon is below the Paxos commit, and grows with epsilon after that', () => {
  assert.equal(run({ epsilonMs: 4 }).writeLatencyMs, run({ commitWait: false }).writeLatencyMs);
  assert.ok(run({ epsilonMs: 12 }).writeLatencyMs > run({ commitWait: false, epsilonMs: 12 }).writeLatencyMs);
});
