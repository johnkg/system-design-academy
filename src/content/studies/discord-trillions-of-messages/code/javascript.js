// Two techniques from Discord's message storage story, as a small model in JavaScript (not Discord's code):
// 1. Time-bucketed partitions: messages are stored under (channel, bucket), so no partition grows for ever, and a
//    "latest messages" query walks buckets from newest to oldest.
// 2. Request coalescing: readers of the same row who arrive while a read is already running join it instead of
//    starting their own, and routing by channel sends them all to the same service instance.
// Time is simulated (days for buckets, milliseconds for reads), so every run prints the same thing.

const DAY_MS = 86400000;
const BUCKET_DAYS = 10; // the window Discord described in 2017 for keeping partitions under 100 MB
const BUCKET_MS = BUCKET_DAYS * DAY_MS;
const NOW_DAY = 99;
const bucketOf = (ts) => Math.floor(ts / BUCKET_MS);

const channels = [
  { name: 'busy-announcements', createdDay: 0, every: 6 * 3600000, from: 40 * DAY_MS }, // a message every 6 hours since day 40
  { name: 'quiet-friends', createdDay: 5, days: [12, 33, 71] }, // three messages in all
];

// The store: "channel:bucket" -> message timestamps, oldest first.
const store = new Map();
function put(channel, ts) {
  const key = `${channel}:${bucketOf(ts)}`;
  if (!store.has(key)) store.set(key, []);
  store.get(key).push(ts);
}
for (const c of channels) {
  if (c.days) c.days.forEach((d) => put(c.name, d * DAY_MS));
  else for (let ts = c.from; ts < NOW_DAY * DAY_MS; ts += c.every) put(c.name, ts);
}

// The newest `limit` messages: start in the current bucket, go back until enough are found or the channel's first bucket is passed.
function latest(c, limit) {
  const found = [];
  let partitions = 0, empty = 0;
  for (let b = bucketOf(NOW_DAY * DAY_MS); b >= bucketOf(c.createdDay * DAY_MS) && found.length < limit; b--) {
    const rows = store.get(`${c.name}:${b}`) ?? [];
    partitions++;
    if (rows.length === 0) empty++;
    for (let i = rows.length - 1; i >= 0 && found.length < limit; i--) found.push(rows[i]);
  }
  return { found: found.length, partitions, empty };
}

console.log(`bucket window ${BUCKET_DAYS} days, today is day ${NOW_DAY} (bucket ${bucketOf(NOW_DAY * DAY_MS)})`);
for (const c of channels) {
  let size = 0;
  for (const [key, rows] of store) if (key.startsWith(c.name + ':')) size = Math.max(size, rows.length);
  const r = latest(c, 25);
  console.log(`${c.name}: largest partition ${size} messages; latest 25 -> found ${r.found}, read ${r.partitions} partitions (${r.empty} empty)`);
}

// Request coalescing. Eight readers ask for the same row; one database read takes 20 ms.
const DB_MS = 20;
const INSTANCES = 3;
const arrivals = [0, 4, 9, 15, 22, 30, 41, 55]; // ms at which readers of the channel's newest row arrive
const hash = (s) => { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 1000003; return h; };

function databaseReads(route, coalesce) {
  const running = new Map(); // "instance:row" -> time the read in progress finishes
  let reads = 0;
  arrivals.forEach((t, i) => {
    const key = `${route(i)}:busy-announcements:${bucketOf(NOW_DAY * DAY_MS)}`;
    if (coalesce && running.has(key) && running.get(key) > t) return; // join the read in progress
    reads++;
    running.set(key, t + DB_MS);
  });
  return reads;
}
const byChannel = () => hash('busy-announcements') % INSTANCES; // same channel, same instance
const anyInstance = (i) => i % INSTANCES; // readers spread round robin

console.log(`${arrivals.length} readers of one row, database read ${DB_MS} ms, ${INSTANCES} service instances`);
console.log(`  no coalescing: ${databaseReads(anyInstance, false)} database reads`);
console.log(`  coalescing, readers spread over instances: ${databaseReads(anyInstance, true)} database reads`);
console.log(`  coalescing, routed by channel to instance ${byChannel()}: ${databaseReads(byChannel, true)} database reads`);

if (databaseReads(byChannel, true) >= databaseReads(anyInstance, true)) process.exit(1);
