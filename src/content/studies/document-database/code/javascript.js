// A replica set failing over, in JavaScript: five nodes with a replicated log (the oplog),
// writes acknowledged either by the primary alone (w:1) or by a majority (w:majority), then the primary dies and an election runs.
// A voter only grants its vote to a candidate whose log is at least as long as its own.

// Five nodes need three votes. Any two groups of three share at least one node, which is why two primaries can never both be elected.
const NODES = 5, MAJORITY = 3;
// A small seeded random number generator, so that every run gives the same output.
let seed = 0;
const next = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 8) % n; };

// A log is just its length here: every secondary holds a prefix of the primary's log.
function trial(n) {
  seed = 1000 + n;
  const len = new Array(NODES).fill(0);                 // node 0 is the primary
  const crashAt = 40 + next(20);
  const isMajorityWrite = [false];                      // write k (1-based) uses w:majority when true
  for (let tick = 1; tick <= crashAt; tick++) {
    len[0]++;
    isMajorityWrite.push(next(2) === 1);
    for (let i = 1; i < NODES; i++) {                   // node 4 sits on a slow link
      const step = next(i === 4 ? 2 : 3);
      len[i] = Math.min(len[0], len[i] + step);
    }
  }
  const commit = [...len].sort((a, b) => b - a)[MAJORITY - 1]; // the longest prefix that a majority holds
  const primaryLen = len[0];

  // Election among the four survivors, in the order their random timeouts fire.
  const order = [1, 2, 3, 4].map((id) => ({ id, timeout: next(150) })).sort((a, b) => a.timeout - b.timeout || a.id - b.id);
  let winner = -1, denied = 0;
  for (const c of order) {
    let votes = 0;
    for (const v of [1, 2, 3, 4]) if (len[c.id] >= len[v]) votes++;
    if (votes >= MAJORITY) { winner = c.id; break; }
    denied++;                                           // too stale to collect a majority
  }
  const keep = len[winner];                             // everything after this is rolled back
  let lostW1 = 0, lostMajority = 0;
  for (let k = keep + 1; k <= primaryLen; k++) {
    if (!isMajorityWrite[k]) lostW1++;                  // w:1 was acknowledged right away, so the client was told "ok"
    else if (k <= commit) lostMajority++;               // acknowledged by a majority: must never happen
  }
  return { crashAt, commit, winner, keep, denied, rolledBack: primaryLen - keep, lostW1, lostMajority };
}

// A partition: a side can elect a primary only if it can reach a majority of the five nodes, otherwise it stays read-only.
function partition(reachable) {
  const canElect = reachable >= MAJORITY;
  return `partition: ${reachable} of ${NODES} nodes reachable, can elect a primary: ${canElect}`;
}

const total = { rolledBack: 0, lostW1: 0, lostMajority: 0, denied: 0 };
for (let n = 1; n <= 8; n++) {
  const r = trial(n);
  console.log(`trial ${n}: crash after ${r.crashAt} writes, committed ${r.commit}, node ${r.winner} wins with ${r.keep}, stale candidates denied ${r.denied}, rolled back ${r.rolledBack}, lost w:1 acks ${r.lostW1}, lost majority acks ${r.lostMajority}`);
  for (const k of Object.keys(total)) total[k] += r[k];
}
console.log(`total: rolled back ${total.rolledBack}, lost w:1 acks ${total.lostW1}, lost majority acks ${total.lostMajority}, denied ${total.denied}`);
for (const side of [1, 2, 3, 4]) console.log(partition(side));
if (total.lostMajority !== 0) process.exit(1);
