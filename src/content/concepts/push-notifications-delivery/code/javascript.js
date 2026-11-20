// 30 notifications are sent over one day through a platform push service to one phone that is offline for a while,
// and to a fleet of 1,000 device tokens, some of them stale. Minutes and integers only; the seed is fixed.
const MINUTES_PER_DAY = 1440;
const NOTIFICATIONS = 30;
const OFFLINE_START = 300;  // the phone loses its connection at 05:00
const FLEET = 1000;

function makeRng(seed) { let s = seed; return () => { s = (s * 48271) % 2147483647; return s; }; }

// One notification about every 48 minutes. About 4 in 10 are "score updates" (newer ones make older ones pointless).
function stream() {
  const next = makeRng(83);
  const list = [];
  for (let k = 0; k < NOTIFICATIONS; k++) {
    const t = k * 48 + (next() % 48);
    const kind = next() % 10 < 4 ? 'score' : 'message';
    const jitter = next() % 16; // how long a normal-priority message waits for the device to be reachable, in minutes
    list.push({ t, kind, jitter });
  }
  return list;
}

// ttl: minutes the platform holds an undelivered message. collapse: score updates share a collapse key.
// priority: 'high' wakes the device at once; 'normal' may wait for it. stalePct: share of the fleet's tokens that are dead.
function run(offlineMin, ttl, collapse, priority, stalePct) {
  const reconnect = Math.min(OFFLINE_START + offlineMin, MINUTES_PER_DAY);
  let delivered = 0, expired = 0, collapsed = 0, delaySum = 0, scoreDelivered = 0;
  const pending = [];
  for (const n of stream()) {
    if (n.t >= OFFLINE_START && n.t < reconnect) { pending.push(n); continue; }  // the platform holds it
    delivered++;                                                                  // device reachable: delivered now
    delaySum += priority === 'high' ? n.jitter % 2 : n.jitter;
    if (n.kind === 'score') scoreDelivered++;
  }
  const lastScore = collapse ? Math.max(-1, ...pending.filter((n) => n.kind === 'score').map((n) => n.t)) : -1;
  for (const n of pending) {
    if (collapse && n.kind === 'score' && n.t !== lastScore) { collapsed++; continue; } // replaced by a newer one with the same key
    if (reconnect - n.t > ttl) { expired++; continue; }                                  // held longer than the TTL: dropped
    delivered++;
    delaySum += reconnect - n.t;
    if (n.kind === 'score') scoreDelivered++;
  }
  const avgDelay = Math.floor(delaySum / delivered);
  // The fleet: every notification is sent to every token. A dead token gets an "invalid token" answer from the platform.
  const stale = Math.floor((FLEET * stalePct) / 100);
  const sends = NOTIFICATIONS * FLEET;
  const wastedKeep = NOTIFICATIONS * stale; // never removed: the same dead tokens are tried for every notification
  const wastedPrune = stale;                // removed after the first "invalid" answer
  console.log(`offline ${offlineMin} min, TTL ${ttl} min, collapse ${collapse ? 'on' : 'off'}, ${priority} priority, ${stalePct}% stale`);
  console.log(`  phone: delivered ${delivered}, expired ${expired}, collapsed ${collapsed}; average delay ${avgDelay} min; ${pending.length} held while offline`);
  console.log(`  fleet: ${sends} sends, ${stale} dead tokens; wasted sends ${wastedKeep} without pruning, ${wastedPrune} with pruning`);
  if (delivered + expired + collapsed !== NOTIFICATIONS) throw new Error('every notification must be accounted for');
}

run(240, 120, false, 'normal', 10);
run(240, 120, true, 'normal', 10);
run(240, 480, true, 'normal', 10);
run(240, 120, false, 'high', 10);
run(600, 60, false, 'normal', 25);
