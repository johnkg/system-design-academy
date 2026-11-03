// A teaching model of the commit-wait idea in the Spanner paper. Transaction T1 commits through a coordinator whose clock is a
// little fast, and a client starts T2 at a coordinator whose clock is a little slow, after T1 has become visible. External
// consistency means T2's commit timestamp must be later than T1's. It is not Google's code or data: the figures are round
// numbers chosen so the effect is easy to see. Kept apart from the page so plain Node can import it in unit tests.

export interface Params {
  /** Hold the commit back until its timestamp has certainly passed (TT.after), as Spanner does. */
  commitWait: boolean;
  /** The uncertainty TrueTime advertises, as half the width of its interval, in milliseconds (the paper's epsilon). */
  epsilonMs: number;
  /** How far apart the two coordinators' clocks really are, in milliseconds. */
  clockGapMs: number;
  /** How long a Paxos commit takes, in milliseconds. The paper measured about 10 ms with one replica. */
  paxosMs: number;
}
export interface Result {
  /** Time until the client is told the write has committed. */
  writeLatencyMs: number;
  /** How long the commit must wait for its timestamp to pass: twice the uncertainty. */
  commitWaitMs: number;
  /** T1's commit timestamp and T2's, in milliseconds after T1 reached its coordinator. */
  firstTimestampMs: number;
  secondTimestampMs: number;
  /** T2's timestamp minus T1's: positive means T2 is correctly ordered after T1. */
  marginMs: number;
  orderPreserved: boolean;
  /** TrueTime's bound is honest when each clock is within epsilon of true time, so the two differ by at most twice epsilon. */
  boundHolds: boolean;
}

/** T2 starts immediately after T1 is acknowledged. */
export const SECOND_STARTS_AFTER_MS = 0;

export function simulate(p: Params): Result {
  const commitWaitMs = 2 * p.epsilonMs;
  // The wait runs alongside the Paxos commit, so the write is acknowledged when the slower of the two has finished.
  const writeLatencyMs = p.commitWait ? Math.max(p.paxosMs, commitWaitMs) : p.paxosMs;
  // The first coordinator's clock is fast by half the gap and the second's is slow by half the gap. Each picks the latest end
  // of its TrueTime interval as its timestamp, which is its clock plus epsilon.
  const firstTimestampMs = p.clockGapMs / 2 + p.epsilonMs;
  const secondArrivesMs = writeLatencyMs + SECOND_STARTS_AFTER_MS;
  const secondTimestampMs = secondArrivesMs - p.clockGapMs / 2 + p.epsilonMs;
  const marginMs = secondTimestampMs - firstTimestampMs;
  return {
    writeLatencyMs, commitWaitMs, firstTimestampMs, secondTimestampMs, marginMs,
    orderPreserved: marginMs > 0, boundHolds: p.clockGapMs <= commitWaitMs,
  };
}
