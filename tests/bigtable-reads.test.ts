import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, CPU_LIMIT_READS_PER_SECOND, type Params } from '../src/models/bigtable-reads.ts';

// The page's default controls: a few writes, no compactions, no Bloom filters, 64 KB blocks, a row that exists.
const defaults: Params = { writes: 5_000, compactions: false, bloomFilters: false, blockKb: 64, rowExists: true };
const run = (overrides: Partial<Params> = {}) => simulate({ ...defaults, ...overrides });
// What the page prints: files, seeks to one decimal (two for small values) and reads a second as a whole number.
const shown = (overrides: Partial<Params> = {}) => {
  const r = run(overrides);
  return { files: r.sstables, seeks: r.seeksPerRead.toFixed(2), kb: r.kbPerRead.toFixed(1), reads: Math.round(r.readsPerSecond) };
};

// The figures below are the ones the break-it lesson quotes, in the order it quotes them (each step adds to the one before).
const many = { writes: 100_000 };
const merged = { ...many, compactions: true };
const filtered = { ...merged, bloomFilters: true };
const smallBlocks = { ...filtered, blockKb: 8 };
const missing = { ...smallBlocks, rowExists: false };

test('a few writes leave five SSTables, and a read looks through three of them on average', () => {
  assert.deepEqual(shown(), { files: 5, seeks: '3.00', kb: '192.0', reads: 391 });
});

test('many writes with no compactions leave a hundred SSTables and reads slow to a crawl', () => {
  assert.deepEqual(shown(many), { files: 100, seeks: '50.50', kb: '3232.0', reads: 23 });
});

test('merging compactions in the background bring the file count and the seeks back down', () => {
  assert.deepEqual(shown(merged), { files: 5, seeks: '3.00', kb: '192.0', reads: 391 });
});

test('Bloom filters cut a read of an existing row to about one seek', () => {
  assert.deepEqual(shown(filtered), { files: 5, seeks: '1.04', kb: '66.6', reads: 1127 });
});

test('smaller blocks pull less data per read, so the same bandwidth serves many more reads', () => {
  assert.deepEqual(shown(smallBlocks), { files: 5, seeks: '1.04', kb: '8.3', reads: 9014 });
});

test('a lookup for a row that does not exist almost never reaches the disk, and is limited only by the CPU', () => {
  const r = run(missing);
  assert.equal(r.seeksPerRead.toFixed(2), '0.05');
  assert.equal(r.readsPerSecond, CPU_LIMIT_READS_PER_SECOND);
});

test('without Bloom filters a lookup for a missing row looks in every file', () => {
  assert.equal(run({ ...many, rowExists: false }).seeksPerRead, 100);
});

test('with 64 KB blocks and one seek per read, the model reproduces the paper’s roughly 1,200 random reads a second', () => {
  const r = run({ writes: 1_000, blockKb: 64 });
  assert.equal(r.seeksPerRead, 1);
  assert.ok(r.readsPerSecond > 1100 && r.readsPerSecond < 1250, `${r.readsPerSecond}`);
});

test('the model is deterministic', () => {
  assert.deepEqual(run(missing), run(missing));
});
