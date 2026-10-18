// A deletion orchestrator in JavaScript: a data map lists every store, each request fans out one task per store,
// failed tasks retry the next day, a legal hold pauses a request, and the lake is erased by destroying a per-user key.
const STORES = ['users-db', 'search-index', 'cache', 'lake', 'warehouse', 'processor-crm'];
const METHOD = { 'users-db': 'delete rows', 'search-index': 'delete docs', cache: 'evict keys', lake: 'shred key', warehouse: 'delete rows', 'processor-crm': 'api call' };
const GRACE = 2; // days between the soft delete and the hard delete
const DEADLINE = 30; // days allowed by law

function fnv(text) {
  let h = 0x811c9dc5;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}
function xorStream(key, bytes) { // a toy stream cipher, only to show the idea of crypto-shredding
  let s = key;
  return bytes.map((b) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return b ^ (s >>> 24); });
}
const keyring = {}; // user -> key; destroying the entry is the erasure
const data = Object.fromEntries(STORES.map((s) => [s, {}]));
for (let user = 1; user <= 6; user++) {
  keyring[user] = fnv('key|' + user);
  STORES.forEach((store, i) => {
    data[store][user] = Array.from({ length: 1 + ((user + i) % 3) }, (_, n) => {
      const text = `${store}:${user}:${n}`;
      return store === 'lake' ? xorStream(keyring[user], [...text].map((c) => c.charCodeAt(0))) : text;
    });
  });
}
function readable(store, user) {
  const rows = data[store][user] || [];
  if (store !== 'lake') return rows.length;
  return keyring[user] === undefined ? 0 : rows.filter((r) => String.fromCharCode(...xorStream(keyring[user], r)).startsWith('lake:')).length;
}
const total = (user) => STORES.reduce((n, s) => n + readable(s, user), 0);

function erase(store, user) {
  if (store === 'lake') delete keyring[user]; // the ciphertext stays in the immutable files, unreadable
  else delete data[store][user];
}

const holds = { 4: 10 }; // user 4 is under a legal hold until day 10
const backup = JSON.parse(JSON.stringify(data['users-db'])); // the day 0 snapshot is never edited
const requests = [{ id: 'r1', user: 2, filed: 0 }, { id: 'r2', user: 4, filed: 0 }, { id: 'r3', user: 5, filed: 1 }]
  .map((r) => ({ ...r, tasks: Object.fromEntries(STORES.map((s) => [s, 0])), done: null }));
const audit = [];

for (const r of requests) {
  const parts = STORES.map((s) => `${s} ${readable(s, r.user)}`);
  console.log(`export ${r.id} (user ${r.user}) day ${r.filed}: ${parts.join(', ')} = ${total(r.user)} records`);
}
for (let day = 0; day <= DEADLINE; day++) {
  for (const r of requests) {
    if (r.done !== null || day < r.filed + GRACE) continue;
    if (holds[r.user] && day < holds[r.user]) continue; // blocked, and nothing is deleted
    for (const store of STORES) {
      if (r.tasks[store] === -1) continue;
      r.tasks[store]++;
      if (store === 'processor-crm' && r.tasks[store] <= r.user % 3) { console.log(`day ${day}: ${r.id} ${store} failed, will retry`); continue; }
      erase(store, r.user);
      r.tasks[store] = -1;
      audit.push({ id: r.id, store, method: METHOD[store], day, who: fnv('salt|' + r.user).toString(16).padStart(8, '0') });
    }
    if (STORES.every((s) => r.tasks[s] === -1)) { r.done = day; console.log(`day ${day}: ${r.id} complete after ${day - r.filed} days`); }
  }
}
console.log(`audit entries: ${audit.length}, first: ${audit[0].method} in ${audit[0].store} for ${audit[0].who}`);
const lakeKept = requests.reduce((n, r) => n + data.lake[r.user].length, 0);
console.log(`lake rows still in the files: ${lakeKept}, readable: ${requests.reduce((n, r) => n + readable('lake', r.user), 0)}`);

const present = (rows) => requests.filter((r) => rows[r.user]).length;
const replay = requests.filter((r) => r.done !== null && r.done <= 20).map((r) => r.user);
const restored = JSON.parse(JSON.stringify(backup));
console.log(`restore on day 20 without the replay list: ${present(restored)} deleted users are back`);
replay.forEach((u) => delete restored[u]);
console.log(`restore on day 20 with the replay list ${JSON.stringify(replay)}: ${present(restored)} deleted users are back`);

const late = requests.filter((r) => r.done === null || r.done > DEADLINE).length;
if (requests.some((r) => total(r.user) !== 0) || late || present(restored) !== 0 || audit.length !== 18) process.exit(1);
