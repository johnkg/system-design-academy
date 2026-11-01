// A miniature of the ideas in GitHub's 2016 post on gh-ost and in gh-ost's documentation of its cut-over, in JavaScript
// (a teaching model, not GitHub's code): copy rows into a ghost table in chunks, replay the change log into it instead of
// using triggers, throttle on replica lag, and swap the tables with a sentry so that a failed cut-over can be retried.
// Everything is deterministic, so every run prints the same thing. All numbers are made up for teaching.

const ROWS = 10; // rows in the original table
const CHUNK = 3; // rows copied at a time
const LAG_LIMIT = 2; // ticks of replica lag above which the migration pauses
const WRITE_TICKS = [1, 2, 4]; // ticks in which the application updates a row

// The original table: row id -> version. The change log is what gh-ost reads instead of triggers.
const original = new Map(Array.from({ length: ROWS }, (_, i) => [i + 1, 1]));
const ghost = new Map();
const log = []; // change events: [row, version]
let logPosition = 0; // how much of the log has been applied to the ghost table

// The application changes row (tick) to a newer version. The change is written to the log, not copied by a trigger.
function applicationWrite(tick) {
  const row = tick + 1;
  original.set(row, original.get(row) + 1);
  log.push([row, original.get(row)]);
}

function copyChunk(next) {
  let copied = 0;
  for (let row = next; row < next + CHUNK && row <= ROWS; row++) {
    // A row the log has not yet replayed is copied with its current version; replaying the log later only moves versions forward.
    ghost.set(row, Math.max(ghost.get(row) ?? 0, original.get(row)));
    copied++;
  }
  return copied;
}

function applyLog() {
  let applied = 0;
  for (; logPosition < log.length; logPosition++) {
    const [row, version] = log[logPosition];
    if (ghost.has(row)) ghost.set(row, Math.max(ghost.get(row), version));
    applied++;
  }
  return applied;
}

// Replica lag for each tick: the replica falls behind during the busy ticks.
const lagAt = (tick) => (tick >= 3 && tick <= 5 ? 3 : 0);

function migrate() {
  console.log('--- migration: copy chunks, replay the log, pause when the replica lags');
  let next = 1;
  let pausedTicks = 0;
  for (let tick = 1; next <= ROWS || logPosition < log.length; tick++) {
    if (WRITE_TICKS.includes(tick)) applicationWrite(tick);
    if (lagAt(tick) > LAG_LIMIT) {
      pausedTicks++;
      console.log(`tick ${tick}: replica lag ${lagAt(tick)} is over ${LAG_LIMIT}, throttled, no writes`);
      continue;
    }
    const copied = next <= ROWS ? copyChunk(next) : 0;
    next += copied;
    const applied = applyLog();
    console.log(`tick ${tick}: copied ${copied} rows, log events replayed ${applied}, ghost has ${ghost.size} of ${ROWS} rows`);
  }
  return pausedTicks;
}

// Cut-over: a sentry blocks the rename until everything is ready, and a failed attempt leaves the original in place.
function cutOver(failFirstAttempt) {
  let live = 'original';
  for (let attempt = 1; ; attempt++) {
    const failed = failFirstAttempt && attempt === 1;
    console.log(`cut-over attempt ${attempt}: ${failed ? `connection lost, table is still the ${live}, queries released` : 'atomic rename done'}`);
    if (!failed) { live = 'ghost'; return { live, attempts: attempt }; }
  }
}

const paused = migrate();
const same = [...original].every(([row, version]) => ghost.get(row) === version);
console.log(`tables identical: ${same ? 'yes' : 'no'}, ticks paused: ${paused}`);
console.log('--- cut-over');
const { live, attempts } = cutOver(true);
console.log(`live table: ${live} after ${attempts} attempts`);
const ok = same && paused === 3 && live === 'ghost' && attempts === 2;
console.log(`checks ${ok ? 'passed' : 'FAILED'}`);
if (!ok) process.exit(1);
