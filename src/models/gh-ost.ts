// A teaching model of the ideas in GitHub's 2016 post on gh-ost, and in gh-ost's documentation of its cut-over. It is not
// GitHub's code or data: the numbers are round figures chosen so the effects are easy to see. One step is one second.
// Kept apart from the page so plain Node can import it in unit tests.

export type Tool = 'triggers' | 'ghost';
export type CutOver = 'twoStep' | 'atomic';
export interface Params {
  tool: Tool;
  /** Pause copying (and, for gh-ost, applying changes) while the replica lags more than LAG_LIMIT_MS. */
  throttle: boolean;
  /** A traffic spike from second SPIKE_START for SPIKE_SECONDS. */
  spike: boolean;
  /** The operator pauses the migration for OPERATOR_PAUSE_SECONDS at the start of the spike. */
  operatorPauses: boolean;
  cutOver: CutOver;
}
export interface Result {
  /** Second at which the copy finished and the cut-over ran, or null if it had not finished when the run ended. */
  finishedAt: number | null;
  /** Seconds in which the primary was asked for more writes than it can do, so the application was slowed down. */
  appSlowedSeconds: number;
  /** The highest the replica's lag reached, in milliseconds. */
  peakLagMs: number;
  /** Queries that arrived while the table did not exist, and so failed. */
  failedAtCutOver: number;
  /** Queries held up for a moment by the cut-over, which then ran normally. */
  blockedAtCutOver: number;
  /** Seconds the copy was held back by the throttle or the operator. */
  pausedSeconds: number;
  /** Writes the primary was asked for each second, as a multiple of what it can do. */
  loadBySecond: number[];
}

export const RUN_SECONDS = 900;
export const LAG_LIMIT_MS = 1_500; // the throttle's threshold on replica lag
export const TABLE_ROWS = 3_000_000; // rows to copy
export const COPY_ROWS_PER_SECOND = 6_000; // when the copy is running
export const PRIMARY_WRITE_CAPACITY = 30_000; // writes per second the primary can do
export const REPLICA_APPLY_CAPACITY = 20_000; // writes per second the replica can apply
export const NORMAL_APP_WRITES = 8_000; // writes per second from the application
export const SPIKE_APP_WRITES = 16_000;
export const SPIKE_START = 100;
export const SPIKE_SECONDS = 100;
export const OPERATOR_PAUSE_SECONDS = 60;
export const TWO_STEP_GAP_SECONDS = 0.5; // how long the table does not exist during a rename in two steps
export const ATOMIC_BLOCK_SECONDS = 0.5; // how long queries are held during the atomic cut-over
const MS_PER_SECOND = 1000;

export function simulate(p: Params): Result {
  const loadBySecond: number[] = [];
  let copied = 0; let lagMs = 0; let peakLag = 0; let slowed = 0; let paused = 0; let finishedAt: number | null = null;
  const pauseEnd = SPIKE_START + OPERATOR_PAUSE_SECONDS;

  for (let t = 0; t < RUN_SECONDS && finishedAt === null; t++) {
    const inSpike = p.spike && t >= SPIKE_START && t < SPIKE_START + SPIKE_SECONDS;
    const appWrites = inSpike ? SPIKE_APP_WRITES : NORMAL_APP_WRITES;
    const operatorPaused = p.operatorPauses && t >= SPIKE_START && t < pauseEnd;
    const throttled = (p.throttle && lagMs > LAG_LIMIT_MS) || operatorPaused;
    if (throttled) paused++;

    // The copy stops whenever the migration is held back, for either tool.
    const copyNow = throttled ? 0 : Math.min(COPY_ROWS_PER_SECOND, TABLE_ROWS - copied);
    // Keeping the new table up to date. A trigger writes inside every application write and cannot be paused.
    // gh-ost applies the changes it read from the binary log itself, so holding it back stops those writes too.
    const keepUpWrites = p.tool === 'triggers' ? appWrites : throttled ? 0 : appWrites;
    const writes = appWrites + keepUpWrites + copyNow;

    const load = writes / PRIMARY_WRITE_CAPACITY;
    loadBySecond.push(load);
    if (load > 1) slowed++;
    // The replica falls behind when it is sent more than it can apply, and catches up at the same pace when it has room.
    lagMs = Math.max(0, lagMs + ((writes - REPLICA_APPLY_CAPACITY) / REPLICA_APPLY_CAPACITY) * MS_PER_SECOND);
    peakLag = Math.max(peakLag, lagMs);

    copied += copyNow;
    if (copied >= TABLE_ROWS) finishedAt = t + 1;
  }

  const appAtCutOver = finishedAt === null ? 0 : appWritesAt(finishedAt, p);
  return {
    finishedAt, appSlowedSeconds: slowed, peakLagMs: Math.round(peakLag), pausedSeconds: paused, loadBySecond,
    failedAtCutOver: finishedAt !== null && p.cutOver === 'twoStep' ? Math.round(appAtCutOver * TWO_STEP_GAP_SECONDS) : 0,
    blockedAtCutOver: finishedAt !== null && p.cutOver === 'atomic' ? Math.round(appAtCutOver * ATOMIC_BLOCK_SECONDS) : 0,
  };
}

function appWritesAt(second: number, p: Params): number {
  const inSpike = p.spike && second >= SPIKE_START && second < SPIKE_START + SPIKE_SECONDS;
  return inSpike ? SPIKE_APP_WRITES : NORMAL_APP_WRITES;
}
