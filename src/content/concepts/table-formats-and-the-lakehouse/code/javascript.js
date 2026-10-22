// A tiny table format: immutable data files, snapshots listing them, and one atomic
// pointer swap (compare-and-swap) in the catalog. Concurrent writers use optimistic retries.

const MAX_RETRIES = 4; // a writer gives up after this many lost compare-and-swaps

class Catalog {
  constructor() {
    this.head = 0;
    this.snapshots = new Map([[0, []]]); // version -> sorted file names (an immutable snapshot)
    this.rows = new Map(); // file name -> row count (data files are never modified)
  }
  cas(expected, files) {
    if (this.head !== expected) return false; // someone else committed first
    this.head++;
    this.snapshots.set(this.head, files);
    return true;
  }
  rowCount(version) {
    return this.snapshots.get(version).reduce((s, f) => s + this.rows.get(f), 0);
  }
}

// Optimistic commit built on snapshot `base`; on a lost race, validate and retry.
function commit(cat, who, base, adds, removes, maxRetries = MAX_RETRIES) {
  let attempts = 0;
  for (;;) {
    attempts++;
    const current = cat.snapshots.get(base);
    const missing = removes.filter((r) => !current.includes(r));
    if (missing.length > 0) {
      console.log(`${who}: abort, ${missing[0]} was already replaced`);
      return 0;
    }
    const files = current.filter((f) => !removes.includes(f)).concat(adds).sort();
    if (cat.cas(base, files)) {
      console.log(`${who}: committed v${cat.head} in ${attempts} attempt(s) -> [${files.join(",")}]`);
      return cat.head;
    }
    if (attempts > maxRetries) {
      console.log(`${who}: gave up`);
      return 0;
    }
    base = cat.head; // re-read the new head, then validate and rebuild
  }
}

function writeFile(cat, name, rows) {
  cat.rows.set(name, rows); // step 1 of every write: data files first, invisible until committed
}

const cat = new Catalog();
writeFile(cat, "f1", 100);
writeFile(cat, "f2", 100);
commit(cat, "seed", 0, ["f1", "f2"], []);

const reader = cat.head; // a long query pins this snapshot
const aBase = cat.head, bBase = cat.head;
writeFile(cat, "f3", 50);
writeFile(cat, "f4", 70);
commit(cat, "A append f3", aBase, ["f3"], []);
commit(cat, "B append f4", bBase, ["f4"], []); // loses the race, rebases, wins

writeFile(cat, "c1", 320);
const cBase = cat.head;
writeFile(cat, "f5", 30);
commit(cat, "C append f5", cat.head, ["f5"], []);
commit(cat, "compact c1", cBase, ["c1"], ["f1", "f2", "f3", "f4"]); // replays on top of C

writeFile(cat, "f5b", 30);
writeFile(cat, "c2", 350);
const dBase = cat.head;
commit(cat, "D rewrite f5", dBase, ["f5b"], ["f5"]);
commit(cat, "compact c2", dBase, ["c2"], ["c1", "f5"]); // f5 is gone: real conflict

for (const v of [1, 3, 5, cat.head]) {
  console.log(`v${v}: ${cat.snapshots.get(v).length} files, ${cat.rowCount(v)} rows`);
}
if (cat.rowCount(3) !== 320 || cat.rowCount(5) !== 350) process.exit(1);
if (cat.rowCount(reader) !== 200) process.exit(1); // the pinned reader never saw any of it

const keep = [cat.head - 1, cat.head]; // expire all but the last two snapshots
const live = new Set(keep.flatMap((v) => cat.snapshots.get(v)));
const dead = [...cat.rows.keys()].filter((f) => !live.has(f)).sort();
console.log(`expire keeps v${keep[0]},v${keep[1]}; deletes ${dead.length} files: ${dead.join(",")}`);
if (dead.join(",") !== "c2,f1,f2,f3,f4") process.exit(1);
