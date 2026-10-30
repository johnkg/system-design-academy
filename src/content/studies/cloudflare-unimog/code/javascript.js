// A miniature of the ideas in Cloudflare's Unimog, in JavaScript (a teaching model, not Cloudflare's code or data):
// every connection's 4-tuple is hashed into a bucket of a forwarding table, each bucket holds a current and a previous
// server, a redirector sends a packet on to the previous server when the current one has no socket for it, a drain keeps
// old connections alive, and a control loop moves buckets from busy servers to idle ones.
// Everything is deterministic and uses whole numbers only, so every run prints the same thing.
const NAMES = ["A", "B", "C"];
const BUCKETS = 64; // always a power of two, so the low 6 bits of the hash pick the bucket (Unimog uses far more than this)
const MASK = BUCKETS - 1;
const NONE = -1;
const CAPACITY = [100, 200, 200]; // how much work each server can do: a different hardware generation each (made-up units)
const BACKGROUND = [0, 150, 0]; // per mille of load from work that has nothing to do with connections (made up)
const CONNECTIONS = 30;
const SPREAD = 20; // the control loop stops when the two loads are this close, per mille
const MAX_ROUNDS = 12;

// 32-bit FNV-1a over the text of a connection's 4-tuple, standing in for Unimog's hash function.
function fnv(text) {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(text)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h;
}

const bucketOf = (conn) => (fnv(`10.0.0.${conn}:5000>203.0.113.7:443`) & MASK) >>> 0;

// each bucket: [first slot, second slot]
const newTable = () => Array.from({ length: BUCKETS }, (_, i) => [i % NAMES.length, NONE]);

// What the redirector does with a packet. A SYN starts a connection and always stays on the first server.
// Any other packet stays there only if that server has a socket for it, and otherwise goes on to the second server.
function deliver(table, sockets, conn, syn) {
  const [first, second] = table[bucketOf(conn)];
  if (syn) return [first, "new connection on first server"];
  if (sockets[first].has(conn)) return [first, "first hop"];
  if (second !== NONE && sockets[second].has(conn)) return [second, "second hop"];
  return [NONE, "reset (connection broken)"];
}

function tally(table, sockets, conns) {
  let broken = 0, hops = 0;
  for (const c of conns) {
    const [server, how] = deliver(table, sockets, c, false);
    if (server === NONE) broken++;
    if (how === "second hop") hops++;
  }
  return [broken, hops];
}

const bucketsPerServer = (table) => NAMES.map((_, s) => table.filter((b) => b[0] === s).length);
// per mille of capacity in use
const loads = (table) => bucketsPerServer(table).map((n, s) => Math.floor((n * 1000) / CAPACITY[s]) + BACKGROUND[s]);

// Pick the candidate with the smallest score; the lowest server number wins a tie.
function lowest(candidates, score) {
  let best = candidates[0];
  for (const c of candidates) if (score(c) < score(best) || (score(c) === score(best) && c < best)) best = c;
  return best;
}

// Drain: stop new connections to a server but keep serving the old ones. With keepOld false the table has only one
// slot per bucket, so the old server is forgotten.
function drain(table, victim, others, keepOld, stamp, touched) {
  let n = 0;
  table.forEach((b, i) => {
    if (b[0] !== victim) return;
    const counts = bucketsPerServer(table);
    b[0] = lowest(others, (s) => counts[s]);
    b[1] = keepOld ? victim : NONE;
    touched[i] = stamp;
    n++;
  });
  return n;
}

// One round of the control loop: servers above the average load give away buckets in proportion to how far above they are,
// and the least loaded server takes them. The least recently changed buckets move first. The new owner becomes the first slot
// and the old owner the second slot, so connections already open on the old owner keep working.
function rebalance(table, active, stamp, touched) {
  const ld = loads(table);
  const avg = Math.floor(active.reduce((sum, s) => sum + ld[s], 0) / active.length);
  let moved = 0;
  for (const s of active) {
    if (ld[s] <= avg) continue;
    const mine = [];
    table.forEach((b, i) => { if (b[0] === s) mine.push(i); });
    const give = Math.max(1, Math.floor((mine.length * (ld[s] - avg)) / ld[s]));
    mine.sort((x, y) => touched[x] - touched[y] || x - y);
    for (const i of mine.slice(0, give)) {
      const to = lowest(active.filter((t) => t !== s), (t) => loads(table)[t]);
      table[i] = [to, s];
      touched[i] = stamp;
      moved++;
    }
  }
  return moved;
}

function show(title, table) {
  const ld = loads(table);
  console.log(`${title}: buckets ` + bucketsPerServer(table).map((n, s) => `${NAMES[s]}=${n}`).join(" ")
    + " | load per mille " + NAMES.map((n, s) => `${n}=${ld[s]}`).join(" "));
}

const conns = Array.from({ length: CONNECTIONS }, (_, i) => i);
const table = newTable();
const touched = new Array(BUCKETS).fill(0);
const sockets = NAMES.map(() => new Set());
for (const c of conns) sockets[table[bucketOf(c)][0]].add(c); // each connection is opened on the first server of its bucket
console.log(`${CONNECTIONS} connections open: ` + NAMES.map((n, s) => `${n}=${sockets[s].size}`).join(" "));
show("start", table);

// 1. Drain server A, first with a one-slot table, then with two slots.
const oneSlot = table.map((b) => [...b]);
drain(oneSlot, 0, [1, 2], false, 1, new Array(BUCKETS).fill(0));
const lostOneSlot = tally(oneSlot, sockets, conns)[0];
console.log(`drain A, one slot per bucket: ${lostOneSlot} of ${sockets[0].size} connections on A broken`);
const n = drain(table, 0, [1, 2], true, 1, touched);
let [broken, hops] = tally(table, sockets, conns);
const lostTwoSlots = broken;
console.log(`drain A, two slots per bucket: ${n} buckets changed, ${broken} broken, ${hops} connections now use a second hop`);
const fresh = Array.from({ length: 12 }, (_, k) => deliver(table, sockets, 100 + k, true)[0]);
console.log("12 new connections go to: " + fresh.map((s) => NAMES[s]).join(" "));

// 2. The connections on A end. A is no longer needed as a second server.
sockets[0].clear();
for (const b of table) if (b[1] === 0) b[1] = NONE;
const live = conns.filter((c) => sockets.some((s) => s.has(c)));
console.log(`A's connections ended, ${live.length} remain, second slots cleared`);

// 3. The control loop works on the servers still in service, until the two loads are within 20 per mille of each other.
show("before the loop", table);
let rnd = 0, lostInLoop = 0;
for (;;) {
  let ld = loads(table);
  if (Math.abs(ld[1] - ld[2]) <= SPREAD || rnd === MAX_ROUNDS) break;
  rnd++;
  const moved = rebalance(table, [1, 2], rnd + 1, touched);
  [broken, hops] = tally(table, sockets, live);
  ld = loads(table);
  lostInLoop += broken;
  console.log(`round ${rnd}: moved ${moved} buckets, load B=${ld[1]} C=${ld[2]}, ${broken} broken, ${hops} on a second hop`);
}
show("after the loop", table);

// 4. The limit: change the same bucket twice in a row and the server from before the first change is forgotten.
// A comes back from maintenance and takes a bucket whose old connections are still open on B.
const target = table.findIndex((b, i) => b[1] !== NONE && live.some((c) => bucketOf(c) === i && sockets[b[1]].has(c)));
const [first, second] = table[target];
const inBucket = live.filter((c) => bucketOf(c) === target);
table[target] = [0, first];
[broken, hops] = tally(table, sockets, inBucket);
console.log(`bucket ${target} changed again before ${NAMES[second]}'s connections ended: ${broken} of ${inBucket.length} broken`);
const ok = lostOneSlot > 0 && lostTwoSlots === 0 && lostInLoop === 0 && broken > 0;
console.log(`checks ${ok ? "passed" : "FAILED"}`);
process.exit(ok ? 0 : 1);
