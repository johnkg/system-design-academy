import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error the audit is a plain script, not a typed module
import { findDrift } from '../scripts/check-estimators.mjs';

// The slider defaults of a study's estimator should agree with the scale its own requirements state (scripts/check-estimators.mjs).
const est = (...sliders: [string, number][]) => sliders.map(([label, value]) => `<RangeField label="${label}" name="x" min="1" max="1000000" value="${value}" />`).join('\n');
const study = (prompt: string, nonFunctional: string[] = []) => ({ prompt, functional: [], nonFunctional });

test('a default far from the stated number is listed, one close to it is not', () => {
  const meta = study('Roll a release out to 50,000 hosts across several regions.');
  assert.equal(findDrift(meta, est(['Hosts (thousands)', 20])).length, 1);
  assert.equal(findDrift(meta, est(['Hosts (thousands)', 50])).length, 0);
  assert.equal(findDrift(meta, est(['Hosts (thousands)', 40])).length, 0); // within a factor of two
});

test('a magnitude phrase is a range', () => {
  const meta = study('Scale to hundreds of thousands of checks per second.');
  assert.equal(findDrift(meta, est(['Peak checks per second', 200000])).length, 0);
  assert.equal(findDrift(meta, est(['Peak checks per second', 2000])).length, 1);
});

test('rates are compared per second, whatever unit each side uses', () => {
  const meta = study('The service handles 50 million searches a day.');
  assert.equal(findDrift(meta, est(['Searches per second', 579])).length, 0); // 50M / 86,400 s
  assert.equal(findDrift(meta, est(['Searches per second', 20])).length, 1);
  assert.equal(findDrift(meta, est(['Searches per day (millions)', 50])).length, 0);
});

test('percentages, ratios and per-user sliders describe behaviour, so they are skipped', () => {
  const meta = study('Serve 50,000 hosts.');
  assert.equal(findDrift(meta, est(['Hosts that fail (%)', 3], ['Share of hosts upgraded', 20], ['Checks per host', 12])).length, 0);
});

test('a count scale in the label is applied, and a slider about something else is not compared', () => {
  const meta = study('Handle 3,000 plugin calls a second from 2,000 plugins.');
  assert.equal(findDrift(meta, est(['Peak plugin calls per second (hundreds)', 30])).length, 0); // 30 hundreds is 3,000
  assert.equal(findDrift(meta, est(['Cache size (GB)', 64])).length, 0);
});

test('years and references in the text are not quantities', () => {
  const meta = study("A 2017 engineering post 'Scaling the queue' describes it.");
  assert.equal(findDrift(meta, est(['Minutes between canary jobs', 1])).length, 0);
});
