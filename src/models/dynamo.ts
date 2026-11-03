// A teaching model of the ideas in the 2007 Dynamo paper: replicas that accept writes during failures, quorums of R and W,
// a stand-in node that holds a hint, and reconciliation of conflicting versions when the data is read. It follows one
// shopping cart through two "add to cart" writes and one read. It is not Amazon's code or data. Everything is exact:
// a read hears from R of the three replicas, and the model counts every possible choice of which R, so there is no randomness.
// Kept apart from the page so plain Node can import it in unit tests.

export type Quorum = 'all' | 'majority' | 'one';
export type Failure = 'none' | 'oneDown' | 'twoDown' | 'partition';
export type Resolution = 'lastWriteWins' | 'merge';
export interface Params {
  quorum: Quorum;
  failure: Failure;
  /** A sloppy quorum: when a replica is unreachable a stand-in node takes its place and holds a hint to hand the data back. */
  hintedHandoff: boolean;
  /** The second client updates the cart without having seen the first client's update. */
  concurrentWriters: boolean;
  resolution: Resolution;
}
export interface Result {
  /** Add-to-cart requests that were refused (0, 1 or 2). */
  rejectedWrites: number;
  /** Of all the ways a read could pick its R replicas, the share whose answer is missing an item that was accepted. */
  staleReadShare: number;
  /** The share of those reads that saw two or more conflicting versions and so had to be reconciled. */
  conflictShare: number;
  /** The fewest copies of any accepted update at the moment it was acknowledged, counting a stand-in's hinted copy. */
  fewestCopies: number;
  /** The items a read that hears from every replica would return. */
  fullCart: string[];
  readQuorum: number;
  writeQuorum: number;
}

export const REPLICAS = 3; // N
const STAND_IN = 3; // index of the stand-in node, after replicas 0, 1 and 2
const QUORUMS: Record<Quorum, { r: number; w: number }> = { all: { r: 3, w: 3 }, majority: { r: 2, w: 2 }, one: { r: 1, w: 1 } };

interface Version { name: string; items: string[]; time: number; ancestors: string[] }
const first: Version = { name: 'v1', items: ['book'], time: 0, ancestors: [] };

/** Nodes (0 to 3) each client's coordinator can reach. */
function reach(failure: Failure): [number[], number[]] {
  switch (failure) {
    case 'none': return [[0, 1, 2, 3], [0, 1, 2, 3]];
    case 'oneDown': return [[0, 1, 3], [0, 1, 3]];
    case 'twoDown': return [[0, 3], [0, 3]];
    case 'partition': return [[0, 3], [1, 2]]; // the first client's side holds replica 0 and the stand-in, the second holds replicas 1 and 2
  }
}

const combinations = (n: number, k: number): number[][] =>
  k === 0 ? [[]] : n < k ? [] : [...combinations(n - 1, k - 1).map((c) => [...c, n - 1]), ...combinations(n - 1, k)];

export function simulate(p: Params): Result {
  const { r, w } = QUORUMS[p.quorum];
  const holds: Version[][] = [[first], [first], [first], []]; // versions on replicas 0, 1, 2 and the stand-in
  const hinted: { version: Version; intended: number }[] = [];
  const reaches = reach(p.failure);
  let rejected = 0; let fewest = Infinity;
  const accepted: Version[] = [];

  const write = (client: 0 | 1, version: Version) => {
    const can = reaches[client];
    // A strict quorum uses only the three replicas. A sloppy quorum also uses the stand-in for a replica it cannot reach.
    const targets: number[] = []; const missing: number[] = [];
    for (let node = 0; node < REPLICAS; node++) (can.includes(node) ? targets : missing).push(node);
    const standIns = p.hintedHandoff && can.includes(STAND_IN) ? missing.slice(0, 1) : [];
    const acks = targets.length + standIns.length;
    if (acks < w) { rejected++; return; }
    targets.forEach((node) => holds[node].push(version));
    standIns.forEach((node) => { holds[STAND_IN].push(version); hinted.push({ version, intended: node }); });
    accepted.push(version); fewest = Math.min(fewest, acks);
  };

  write(0, { name: 'w1', items: ['book', 'pen'], time: 1, ancestors: ['v1'] });
  const firstAccepted = accepted.some((v) => v.name === 'w1');
  // Across a partition the second client cannot have seen the first client's write, so those two writes are always concurrent.
  const concurrent = p.concurrentWriters || p.failure === 'partition' || !firstAccepted;
  const second: Version = concurrent
    ? { name: 'w2', items: ['book', 'mug'], time: 2, ancestors: ['v1'] }
    : { name: 'w2', items: ['book', 'pen', 'mug'], time: 2, ancestors: ['v1', 'w1'] };
  write(1, second);
  // The failure heals and each stand-in hands its hinted copy to the replica it stood in for.
  for (const { version, intended } of hinted) holds[intended].push(version);

  const wanted = new Set(accepted.flatMap((v) => v.items));
  const leaves = (versions: Version[]): Version[] => {
    const unique = [...new Map(versions.map((v) => [v.name, v])).values()];
    return unique.filter((v) => !unique.some((o) => o.ancestors.includes(v.name)));
  };
  const answer = (versions: Version[]): string[] => {
    const l = leaves(versions);
    return p.resolution === 'merge' ? [...new Set(l.flatMap((v) => v.items))] : [...l.reduce((a, b) => (b.time > a.time ? b : a)).items];
  };

  const picks = combinations(REPLICAS, r);
  const stale = picks.filter((pick) => { const got = answer(pick.flatMap((i) => holds[i])); return [...wanted].some((item) => !got.includes(item)); }).length;
  const conflicts = picks.filter((pick) => leaves(pick.flatMap((i) => holds[i])).length > 1).length;
  return {
    rejectedWrites: rejected, staleReadShare: stale / picks.length, conflictShare: conflicts / picks.length,
    fewestCopies: accepted.length ? fewest : 0, fullCart: answer([0, 1, 2].flatMap((i) => holds[i])).sort(), readQuorum: r, writeQuorum: w,
  };
}
