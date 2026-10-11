// Splitting users.full_name into first_name|last_name while live writes keep arriving.
// Four migration orders run on the same seeded write stream; only the safe ones end equal to the old table.

const N = 1000, CHUNK = 50, WRITES = 12; // rows, rows per backfill batch, live writes between steps
let seed = 12345;
const rand = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return (seed >>> 8) % n; };
const split = (name) => { const i = name.indexOf(" "); return name.slice(0, i) + "|" + name.slice(i + 1); };

function migrate(mode) {
  seed = 12345;
  const old = Array.from({ length: N }, (_, i) => `f${i} l${i}`); // the live table: full_name
  const next = new Array(N).fill(null);                            // the new columns (or the shadow table)
  let dualWrite = mode !== "backfill-first";                       // is the app writing both shapes yet?
  let version = 0;

  function liveWrites() {                                          // the application keeps renaming users
    for (let k = 0; k < WRITES; k++) {
      const id = rand(N);
      old[id] = `f${id}w${++version} l${id}`;
      if (dualWrite || mode === "shadow") next[id] = split(old[id]); // dual-write, or REPLACE from the change log
    }
  }

  for (let start = 0; start < N; start += CHUNK) {
    if (mode === "backfill-first" && start === N / 2) dualWrite = true; // dual-write deployed too late
    const end = start + CHUNK;
    if (mode === "rmw" || mode === "shadow") {
      const snapshot = old.slice(start, end); // read the batch ...
      liveWrites();                           // ... a live write lands in between ...
      for (let i = start; i < end; i++) {
        const derived = split(snapshot[i - start]);
        if (mode === "rmw") next[i] = derived;                      // ... blind write-back clobbers it
        else if (next[i] === null) next[i] = derived;               // INSERT IGNORE: the log already won
      }
    } else {
      liveWrites();
      for (let i = start; i < end; i++) if (next[i] === null) next[i] = split(old[i]); // UPDATE ... WHERE first_name IS NULL
    }
    liveWrites();
  }
  let wrong = 0;
  for (let i = 0; i < N; i++) if (next[i] !== split(old[i])) wrong++;
  return { wrong, version };
}

const modes = [
  ["dual-write first, then backfill", "dual", true],
  ["backfill first, dual-write late", "backfill-first", false],
  ["backfill reads, then blind writes", "rmw", false],
  ["shadow copy + change log", "shadow", true],
];
for (const [label, mode, mustBeSafe] of modes) {
  const { wrong, version } = migrate(mode);
  console.log(`${label}: ${wrong} of ${N} rows wrong after ${version} live writes`);
  if (mustBeSafe !== (wrong === 0)) { console.error("invariant violated: " + label); process.exit(1); }
}
console.log("safe orders match the old table; unsafe orders lose updates");
