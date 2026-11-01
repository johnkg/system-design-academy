import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, TOTAL_DATA_TB, WORKSPACES, type Params } from '../src/models/notion-sharding.ts';

const defaults: Params = { logicalShards: 32, databases: 32, bigWorkspace: false };
const run = (overrides: Partial<Params> = {}) => simulate({ ...defaults, ...overrides });
// What the page prints: terabytes and ratios to one decimal.
const shown = (overrides: Partial<Params> = {}) => {
  const r = run(overrides);
  return {
    average: r.averageDatabaseTb.toFixed(1), heaviest: r.heaviestDatabaseTb.toFixed(1), imbalance: r.imbalance.toFixed(1),
    heaviestShard: r.heaviestLogicalShardTb.toFixed(1), perDatabase: `${r.logicalShardsPerDatabase.min}-${r.logicalShardsPerDatabase.max}`,
  };
};

// The figures below are the ones the break-it lesson quotes, in the order it quotes them (each step adds to the one before).
test('one logical shard per database: the workspace hash spreads data evenly overall', () => {
  assert.deepEqual(shown(), { average: '3.1', heaviest: '3.5', imbalance: '1.1', heaviestShard: '3.5', perDatabase: '1-1' });
});

test('480 logical shards leave the databases as they were but make the biggest unit to move far smaller', () => {
  assert.deepEqual(shown({ logicalShards: 480 }), { average: '3.1', heaviest: '3.5', imbalance: '1.1', heaviestShard: '0.6', perDatabase: '15-15' });
});

test('480 shards do not divide over 35 databases, so some hold 14 shards and some 13', () => {
  assert.deepEqual(shown({ logicalShards: 480, databases: 35 }), { average: '2.9', heaviest: '3.3', imbalance: '1.2', heaviestShard: '0.6', perDatabase: '13-14' });
});

test('480 shards divide evenly over 40 databases, 12 each, so the cluster can grow in even steps', () => {
  assert.deepEqual(shown({ logicalShards: 480, databases: 40 }), { average: '2.5', heaviest: '2.9', imbalance: '1.2', heaviestShard: '0.6', perDatabase: '12-12' });
  for (const databases of [32, 40, 48]) assert.equal(480 % databases, 0);
});

test('one workspace holding 5% of the data cannot be split, whatever the layout', () => {
  assert.deepEqual(shown({ logicalShards: 480, databases: 40, bigWorkspace: true }), { average: '2.5', heaviest: '7.2', imbalance: '2.9', heaviestShard: '5.1', perDatabase: '12-12' });
  assert.ok(run({ logicalShards: 480, bigWorkspace: true }).heaviestLogicalShardTb >= 5);
  assert.ok(run({ logicalShards: 4800, bigWorkspace: true }).heaviestLogicalShardTb >= 5);
});

test('every terabyte lands somewhere: the databases add up to the total', () => {
  for (const overrides of [{}, { logicalShards: 480, databases: 35 }, { bigWorkspace: true }]) {
    const total = run(overrides).databaseTb.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - TOTAL_DATA_TB) < 1e-6, JSON.stringify(overrides));
  }
  assert.equal(WORKSPACES, 20_000);
});

test('the model is deterministic', () => {
  assert.deepEqual(run({ logicalShards: 480 }), run({ logicalShards: 480 }));
});
