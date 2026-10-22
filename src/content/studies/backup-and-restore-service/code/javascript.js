// Full plus incremental backups with retention, a vault that refuses deletes, and restore verification, in JavaScript.
// A toy database of 32 pages is backed up daily. Ransomware starts garbling pages on day 18, and on day 23 it tries to delete every backup.

const PAGES = 32, DAYS = 24, FULL_EVERY = 7, KEEP = 14, LOCK = KEEP + FULL_EVERY, ATTACK_DAY = 18;

const SEED = 7;
const PAGE_CHECK = 97; // every valid page value is a multiple of 97, so garbled pages are detectable
const VALUE_RANGE = 1000, WRITES_PER_DAY = 6, GARBLED_PER_DAY = 8;

let seed = SEED;
const random = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 16) % n; };

// A 32-bit FNV style hash of the whole database, recorded with each backup so a restore can be compared with the original.
const hash = (pages) => pages.reduce((h, v) => Math.imul(h ^ v, 16777619) >>> 0, 2166136261);

// The vault refuses to delete a backup before its lock expires, even for an administrator.
class Vault {
  constructor() { this.items = new Map(); }
  put(backup) { this.items.set(backup.day, { backup, lockUntil: backup.day + LOCK }); }
  remove(day, today) {
    if (today < this.items.get(day).lockUntil) return false;
    return this.items.delete(day);
  }
}

// Keep every backup younger than KEEP days and the chain it needs: the last full backup and each incremental after it.
function prune(vault, today) {
  const needed = new Set();
  for (const day of vault.items.keys()) {
    if (today - day < KEEP) for (let d = day - (day % FULL_EVERY); d <= day; d++) needed.add(d);
  }
  for (const day of [...vault.items.keys()]) if (!needed.has(day)) vault.remove(day, today);
}

// Rebuild the database as it was on a given day: start from the full backup, then apply each incremental in order.
function restore(vault, day) {
  const state = new Array(PAGES).fill(0);
  for (let d = day - (day % FULL_EVERY); d <= day; d++) {
    if (!vault.items.has(d)) return null;
    for (const [i, v] of vault.items.get(d).backup.pages) state[i] = v;
  }
  return state;
}

const prod = Array.from({ length: PAGES }, (_, i) => (i + 1) * PAGE_CHECK);
const dirty = new Array(PAGES).fill(true);
const touch = (i, v) => { prod[i] = v; dirty[i] = true; };
const vault = new Vault();
let fulls = 0, written = 0;

for (let day = 0; day < DAYS; day++) {
  for (let k = 0; k < WRITES_PER_DAY; k++) touch(random(PAGES), random(VALUE_RANGE) * PAGE_CHECK);
  if (day >= ATTACK_DAY) for (let k = 0; k < GARBLED_PER_DAY; k++) touch(random(PAGES), random(VALUE_RANGE) * PAGE_CHECK + 1 + random(PAGE_CHECK - 1)); // garbled
  const full = day % FULL_EVERY === 0;
  const pages = prod.map((v, i) => [i, v]).filter(([i]) => full || dirty[i]);
  vault.put({ day, full, pages, hash: hash(prod) });
  dirty.fill(false);
  if (full) fulls++;
  written += pages.length;
  prune(vault, day);
}
console.log(`${fulls} full and ${DAYS - fulls} incremental backups wrote ${written} pages (daily fulls would write ${PAGES * DAYS})`);
const days = [...vault.items.keys()].sort((a, b) => a - b);
console.log(`the vault holds ${days.length} backups, from day ${days[0]} to day ${days[days.length - 1]}`);

const refused = days.filter((d) => !vault.remove(d, DAYS - 1)).length;
console.log(`attacker deletes ${days.length - refused} of ${days.length} backups, the vault refuses ${refused}`);

let clean = -1;
for (let day = DAYS - 1; day >= 0 && clean < 0; day--) {
  const state = restore(vault, day);
  const hashOk = hash(state) === vault.items.get(day).backup.hash;
  const dataOk = state.every((v) => v % PAGE_CHECK === 0);
  console.log(`restore test day ${day}: hash ${hashOk ? 'ok' : 'BAD'}, data check ${dataOk ? 'passed' : 'FAILED'}`);
  if (hashOk && dataOk) clean = day;
}
console.log(`newest clean restore point: day ${clean}, so ${DAYS - 1 - clean} days of changes are lost`);
if (refused !== days.length || clean !== ATTACK_DAY - 1) process.exit(1);
