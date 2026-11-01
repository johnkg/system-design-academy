// A teaching model of the layout described in Notion's 2021 post on sharding Postgres: data is partitioned by workspace,
// workspaces are hashed into logical shards, and logical shards are grouped onto physical databases. It is not Notion's
// data: the workspace sizes are invented (many small, a few huge) so the effects are easy to see. Kept apart from the
// page so plain Node can import it in unit tests.
import { mulberry32 } from '../playground.ts';

export interface Params {
  /** Logical shards: Postgres schemas, each with its own copy of every sharded table. */
  logicalShards: number;
  /** Physical databases the logical shards are spread over. */
  databases: number;
  /** One workspace that holds BIG_WORKSPACE_SHARE of all the data, and cannot be split because every block belongs to one workspace. */
  bigWorkspace: boolean;
}
export interface Result {
  averageDatabaseTb: number;
  heaviestDatabaseTb: number;
  /** Heaviest database divided by the average: 1 is a perfect spread. */
  imbalance: number;
  heaviestLogicalShardTb: number;
  /** The fewest and most logical shards any one database holds. */
  logicalShardsPerDatabase: { min: number; max: number };
  databaseTb: number[];
}

export const WORKSPACES = 20_000;
export const TOTAL_DATA_TB = 100; // all data, in a made-up unit of terabytes
export const BIG_WORKSPACE_SHARE = 0.05;
const SIZE_SEED = 21;
const HASH_SEED = 99;
const TAIL_EXPONENT = 1.8; // how heavy the tail of workspace sizes is: smaller means a few workspaces hold more

/** Workspace sizes: most are small and a few are very large (a Pareto-style tail), scaled to add up to the total. */
function workspaceSizes(): number[] {
  const rnd = mulberry32(SIZE_SEED);
  const raw = Array.from({ length: WORKSPACES }, () => (1 - rnd()) ** (-1 / TAIL_EXPONENT));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((x) => (x / sum) * TOTAL_DATA_TB);
}

export function simulate(p: Params): Result {
  let sizes = workspaceSizes();
  if (p.bigWorkspace) {
    const rest = TOTAL_DATA_TB * (1 - BIG_WORKSPACE_SHARE);
    const others = sizes.slice(1); const sum = others.reduce((a, b) => a + b, 0);
    sizes = [TOTAL_DATA_TB * BIG_WORKSPACE_SHARE, ...others.map((x) => (x / sum) * rest)];
  }
  // Each workspace id is hashed to one logical shard, evenly across shards, like Notion's uniform buckets of workspace UUIDs.
  const hash = mulberry32(HASH_SEED);
  const shardTb = new Array<number>(p.logicalShards).fill(0);
  for (const size of sizes) shardTb[Math.floor(hash() * p.logicalShards)] += size;
  // Consecutive logical shards share a database. When the shards do not divide evenly, some databases get one more than others.
  const databaseTb = new Array<number>(p.databases).fill(0);
  const shardsOn = new Array<number>(p.databases).fill(0);
  shardTb.forEach((tb, i) => {
    const db = Math.floor((i * p.databases) / p.logicalShards);
    databaseTb[db] += tb; shardsOn[db]++;
  });
  const average = TOTAL_DATA_TB / p.databases;
  const heaviest = Math.max(...databaseTb);
  return {
    averageDatabaseTb: average, heaviestDatabaseTb: heaviest, imbalance: heaviest / average,
    heaviestLogicalShardTb: Math.max(...shardTb), logicalShardsPerDatabase: { min: Math.min(...shardsOn), max: Math.max(...shardsOn) }, databaseTb,
  };
}
