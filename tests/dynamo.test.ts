import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, type Params } from '../src/models/dynamo.ts';

// The page's default controls: everything healthy, a majority quorum, strict replicas only, one client after another, merging.
const defaults: Params = { quorum: 'majority', failure: 'none', hintedHandoff: false, concurrentWriters: false, resolution: 'merge' };
const run = (overrides: Partial<Params> = {}) => simulate({ ...defaults, ...overrides });
const percent = (x: number) => Math.round(100 * x);
const shown = (p: Partial<Params>) => {
  const r = run(p);
  return { rejected: r.rejectedWrites, stale: percent(r.staleReadShare), conflicts: percent(r.conflictShare), copies: r.fewestCopies, cart: r.fullCart.join(', ') };
};

// The figures below are the ones the break-it lesson quotes, in the order it quotes them (each step adds to the one before).
const step2 = { failure: 'twoDown' as const };
const step3 = { ...step2, quorum: 'one' as const };
const step4 = { ...step3, quorum: 'majority' as const, hintedHandoff: true };
const step5 = { ...step4, failure: 'partition' as const, resolution: 'lastWriteWins' as const };
const step6 = { ...step5, resolution: 'merge' as const };

test('healthy replicas and a majority quorum: every add-to-cart works and every read is complete', () => {
  assert.deepEqual(shown({}), { rejected: 0, stale: 0, conflicts: 0, copies: 3, cart: 'book, mug, pen' });
});

test('a strict majority quorum refuses writes when two of three replicas are down', () => {
  assert.deepEqual(shown(step2), { rejected: 2, stale: 0, conflicts: 0, copies: 0, cart: 'book' });
});

test('accepting a write on one replica keeps the store writable but leaves one copy and stale reads', () => {
  assert.deepEqual(shown(step3), { rejected: 0, stale: 67, conflicts: 0, copies: 1, cart: 'book, mug, pen' });
});

test('a sloppy quorum with hinted handoff keeps the store writable with two copies and no stale reads', () => {
  assert.deepEqual(shown(step4), { rejected: 0, stale: 0, conflicts: 0, copies: 2, cart: 'book, mug, pen' });
});

test('across a partition both sides accept the cart, and last write wins silently drops an item', () => {
  assert.deepEqual(shown(step5), { rejected: 0, stale: 100, conflicts: 100, copies: 2, cart: 'book, mug' });
});

test('merging the conflicting versions in the application keeps every item', () => {
  assert.deepEqual(shown(step6), { rejected: 0, stale: 0, conflicts: 100, copies: 2, cart: 'book, mug, pen' });
});

test('a strict quorum on a partition refuses the side that cannot reach a majority', () => {
  assert.equal(run({ failure: 'partition' }).rejectedWrites, 1);
  assert.equal(run({ failure: 'partition', hintedHandoff: true }).rejectedWrites, 0);
});

test('with R plus W above N, a read always overlaps the latest write: no stale reads with one replica down', () => {
  assert.equal(run({ failure: 'oneDown' }).staleReadShare, 0);
  assert.ok(run({ failure: 'oneDown', quorum: 'one' }).staleReadShare > 0);
});

test('the model is deterministic', () => {
  assert.deepEqual(run(step5), run(step5));
});
