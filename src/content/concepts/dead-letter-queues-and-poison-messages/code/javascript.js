// Dead-letter queues: one ordered consumer over a seeded message list, four failure policies.
// Time is counted in ticks (one processing attempt per tick), so the output is deterministic.
const SEED = 7, TOTAL = 40, LIMIT = 3, HORIZON = 400;
const POISON_PCT = 8, TRANSIENT_PCT = 17; // share of messages that always fail / fail for a while

function makeKinds() {
  let x = SEED;
  const kinds = [];
  for (let i = 0; i < TOTAL; i++) {
    x = (x * 48271) % 2147483647; // MINSTD, integer only
    const r = x % 100;
    kinds.push(r < POISON_PCT ? "poison" : r < POISON_PCT + TRANSIENT_PCT ? "transient" : "ok");
  }
  return kinds;
}

// poison always fails; transient fails on its first attempt only
const attemptOk = (kind, n) => kind === "ok" || (kind === "transient" && n > 1);

function run(policy, kinds) {
  let queue = Array.from({ length: TOTAL }, (_, i) => i);
  let delayed = []; // [dueTick, id]
  const tries = new Array(TOTAL).fill(0);
  const delivered = [], dropped = [], parked = [];
  let attempts = 0;
  for (let tick = 0; tick < HORIZON; tick++) {
    const due = delayed.filter((d) => d[0] <= tick);
    delayed = delayed.filter((d) => d[0] > tick);
    queue = queue.concat(due.map((d) => d[1])); // retry queue feeds the back of the main queue
    if (queue.length === 0) continue;
    const mid = queue[0];
    tries[mid]++;
    attempts++;
    if (attemptOk(kinds[mid], tries[mid])) {
      queue.shift();
      delivered.push(mid);
    } else if (policy === "forever") {
      // stays at the head: redelivered in place, blocking the queue
    } else if (policy === "backoff" && tries[mid] < LIMIT) {
      queue.shift();
      delayed.push([tick + 2 ** tries[mid], mid]); // wait 2, 4, ... ticks
    } else if (policy !== "backoff" && tries[mid] < LIMIT) {
      // immediate retry in place
    } else {
      queue.shift();
      (policy === "drop" ? dropped : parked).push(mid);
    }
  }
  const stuck = queue.length + delayed.length;
  const pos = new Map(delivered.map((m, i) => [m, i]));
  let inversions = 0;
  for (const a of delivered) for (const b of delivered) if (a < b && pos.get(a) > pos.get(b)) inversions++;
  return { delivered: delivered.length, dropped: dropped.length, parked: parked.length, stuck, attempts, inversions };
}

const kinds = makeKinds();
const count = (k) => kinds.filter((v) => v === k).length;
console.log(`messages=${TOTAL} poison=${count("poison")} transient=${count("transient")} limit=${LIMIT}`);
const res = {};
for (const p of ["forever", "drop", "dlq", "backoff"]) {
  const r = (res[p] = run(p, kinds));
  console.log(`${p.padEnd(8)} delivered=${r.delivered} dropped=${r.dropped} parked=${r.parked} ` +
    `stuck=${r.stuck} attempts=${r.attempts} inversions=${r.inversions}`);
}

const need = (c, m) => { if (!c) { console.error("FAILED: " + m); process.exit(1); } };
const poison = count("poison");
need(res.forever.stuck > 0 && res.forever.delivered < TOTAL - poison, "forever blocks");
for (const p of ["dlq", "backoff"]) {
  need(res[p].stuck === 0 && res[p].dropped === 0, p + " stuck or dropped");
  need(res[p].delivered + res[p].parked === TOTAL, p + " lost a message");
  need(res[p].parked === poison, p + " parked a healthy message");
}
need(res.drop.dropped === poison, "drop loses poison");
need(res.dlq.inversions === 0 && res.backoff.inversions > 0, "ordering trade-off");
console.log("ok: forever blocks, drop loses, dlq and backoff lose nothing");
