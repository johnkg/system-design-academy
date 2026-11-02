import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, RUN_SECONDS, type Params } from '../src/models/gh-ost.ts';

// The page's default controls: a trigger-based tool, no throttle, steady traffic, no operator pause, a rename in two steps.
const defaults: Params = { tool: 'triggers', throttle: false, spike: false, operatorPauses: false, cutOver: 'twoStep' };
const run = (overrides: Partial<Params> = {}) => simulate({ ...defaults, ...overrides });
const shown = (p: Partial<Params>) => {
  const r = run(p);
  return { finishedAt: r.finishedAt, appSlowedSeconds: r.appSlowedSeconds, peakLagMs: r.peakLagMs, failedAtCutOver: r.failedAtCutOver, blockedAtCutOver: r.blockedAtCutOver };
};

// The figures below are the ones the break-it lesson quotes, in the order it quotes them (each step adds to the one before).
const step2 = { throttle: true };
const step3 = { ...step2, spike: true };
const step4 = { ...step3, tool: 'ghost' as const };
const step5 = { ...step4, operatorPauses: true };
const step6 = { ...step5, cutOver: 'atomic' as const };

test('a trigger-based tool that ignores replica lag finishes quickly but lets lag build to 50 seconds, then the rename fails queries', () => {
  assert.deepEqual(shown({}), { finishedAt: 500, appSlowedSeconds: 0, peakLagMs: 50_000, failedAtCutOver: 4000, blockedAtCutOver: 0 });
});

test('throttling the copy keeps lag near its limit and makes the migration slower', () => {
  const r = shown(step2);
  assert.deepEqual(r, { finishedAt: 742, appSlowedSeconds: 0, peakLagMs: 1600, failedAtCutOver: 4000, blockedAtCutOver: 0 });
  assert.equal(run(step2).pausedSeconds, 242);
});

test('triggers keep writing during a spike even when the copy is throttled, so the migration cannot finish', () => {
  assert.deepEqual(shown(step3), { finishedAt: null, appSlowedSeconds: 100, peakLagMs: 61_600, failedAtCutOver: 0, blockedAtCutOver: 0 });
});

test('gh-ost pauses the work that keeps the new table up to date, so the primary is slowed for far less time and the migration finishes', () => {
  assert.deepEqual(shown(step4), { finishedAt: 660, appSlowedSeconds: 18, peakLagMs: 2400, failedAtCutOver: 4000, blockedAtCutOver: 0 });
});

test('an operator pausing gh-ost at the spike slows the application for even less time', () => {
  assert.deepEqual(shown(step5), { finishedAt: 671, appSlowedSeconds: 9, peakLagMs: 2400, failedAtCutOver: 4000, blockedAtCutOver: 0 });
});

test('the atomic cut-over holds queries for a moment instead of failing them', () => {
  assert.deepEqual(shown(step6), { finishedAt: 671, appSlowedSeconds: 9, peakLagMs: 2400, failedAtCutOver: 0, blockedAtCutOver: 4000 });
});

test('a trigger-based tool cannot be paused: an operator pause does not stop its writes during a spike', () => {
  const triggers = run({ spike: true, operatorPauses: true });
  const ghost = run({ tool: 'ghost', spike: true, operatorPauses: true });
  assert.equal(triggers.appSlowedSeconds, 100);
  assert.ok(ghost.appSlowedSeconds < triggers.appSlowedSeconds);
});

test('the run is bounded and deterministic', () => {
  const r = run(step3);
  assert.ok(r.loadBySecond.length <= RUN_SECONDS);
  assert.deepEqual(r, run(step3));
});
