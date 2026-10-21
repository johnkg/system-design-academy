// Point-in-time recovery in JavaScript: a base backup plus an ordered change log (the WAL archive).
// restore() copies the base, then replays records in LSN order until the target time or LSN.
const SECONDS_PER_MINUTE = 60, SECONDS_PER_HOUR = 3600;
const MISSING_LSN = 6; // the archive segment we drop to show a broken chain
const pad = (n) => String(n).padStart(2, "0");
const clock = (t) => `${pad(Math.floor(t / SECONDS_PER_HOUR))}:${pad(Math.floor((t % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE))}:${pad(t % SECONDS_PER_MINUTE)}`;
const at = (h, m, s = 0) => h * SECONDS_PER_HOUR + m * SECONDS_PER_MINUTE + s;
const MISTAKE_AT = at(14, 3); // when the DELETE without WHERE runs

function apply(orders, rec) {
  if (rec.op === "delete_all") orders.clear();
  else orders.set(rec.id, rec.total); // insert and update both set the row
}

class Primary {
  constructor() {
    this.orders = new Map();
    this.log = []; // ordered change log: {lsn, ts, op, id, total}
  }
  do(ts, op, id = 0, total = 0) {
    const rec = { lsn: this.log.length + 1, ts, op, id, total };
    this.log.push(rec); // log first, then change the table
    apply(this.orders, rec);
    return rec.lsn;
  }
  baseBackup(ts) {
    return { ts, lsn: this.log.length, orders: new Map(this.orders) };
  }
}

function restore(base, archive, targetTs = null, targetLsn = null) {
  const orders = new Map(base.orders);
  let expected = base.lsn + 1;
  let last = base.lsn;
  for (const rec of archive) {
    if (rec.lsn <= base.lsn) continue; // already contained in the base backup
    if (rec.lsn !== expected) throw new Error(`archive gap: expected LSN ${expected}, found ${rec.lsn}`);
    if (targetTs !== null && rec.ts > targetTs) break;
    if (targetLsn !== null && rec.lsn > targetLsn) break;
    apply(orders, rec);
    last = rec.lsn;
    expected++;
  }
  return [orders, last];
}

const show = (orders) =>
  [...orders.keys()].sort((a, b) => a - b).map((k) => `${k}=${orders.get(k)}`).join(" ") || "(empty)";
const eq = (a, b) => show(a) === show(b);

const db = new Primary();
for (const [id, total] of [[1, 20], [2, 40], [3, 15]]) db.do(at(1, 0), "insert", id, total);
const base = db.baseBackup(at(2, 0)); // 02:00 base backup
db.do(at(2, 10), "insert", 4, 30);
db.do(at(9, 30), "insert", 5, 40);
db.do(at(11, 45), "update", 2, 55);
db.do(at(13, 59, 58), "insert", 6, 25);
const bad = db.do(at(14, 3), "delete_all"); // the mistake
db.do(at(14, 3, 30), "insert", 7, 35);
const archive = db.log;
console.log(`base backup ${clock(base.ts)} covers up to LSN ${base.lsn}; archive holds LSN ${base.lsn + 1}..${archive.length}`);
console.log(`DELETE without WHERE is LSN ${bad} at ${clock(archive[bad - 1].ts)}`);

const [good, n] = restore(base, archive, MISTAKE_AT - 1);
console.log(`restore to ${clock(MISTAKE_AT - 1)}: applied through LSN ${n}: ${show(good)}`);
const [byLsn, n2] = restore(base, archive, null, bad - 1);
console.log(`restore to LSN ${bad - 1}: ${show(byLsn)}`);
const same = eq(byLsn, good);
console.log(`same result by time and by LSN: ${same}`);
const [after] = restore(base, archive, MISTAKE_AT);
console.log(`restore to ${clock(MISTAKE_AT)}: ${show(after)}`);
const [latest] = restore(base, archive);
console.log(`restore to end of log: ${show(latest)}`);
console.log(`replica (replays everything): ${show(db.orders)}`);
console.log(`base backup only (no archive): ${show(base.orders)}`);
try {
  restore(base, archive.filter((r) => r.lsn !== MISSING_LSN));
} catch (e) {
  console.log(`broken archive: ${e.message}`);
}

const check = (cond, msg) => { if (!cond) { console.error("FAILED: " + msg); process.exit(1); } };
check(show(good) === "1=20 2=55 3=15 4=30 5=40 6=25" && n === bad - 1, "restore before the delete");
check(same && n2 === bad - 1, "time and LSN targets agree");
check(show(after) === "(empty)" && show(latest) === "7=35" && eq(db.orders, latest), "later targets reproduce the delete");
check(show(base.orders) === "1=20 2=40 3=15", "base backup is a snapshot, unaffected by later changes");
