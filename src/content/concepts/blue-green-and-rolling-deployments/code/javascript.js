// A rolling-update planner. Given max surge and max unavailable, it produces the sequence of steps
// (start a v2 server, stop a v1 server) and checks that capacity never drops below the minimum.
// Integers only and no clock: one tick is one second, so the output is the same every run.

function plan(n, maxSurge, maxUnavailable, readyAfter) {
  if (maxSurge === 0 && maxUnavailable === 0) throw new Error("surge 0 and unavailable 0 can never make progress");
  let old = n; // v1 servers, all ready
  let newReady = 0; // ready v2 servers
  let starting = []; // countdowns for v2 servers that are still booting
  const rows = [];
  for (let tick = 0; tick < 200; tick++) {
    let started = 0, stopped = 0;
    for (;;) {
      const newCount = newReady + starting.length;
      const total = old + newCount;
      if (newCount < n && total < n + maxSurge) {
        starting.push(readyAfter); // surge: bring up a v2 server first
        started++;
      } else if (old > 0 && old + newReady - 1 >= n - maxUnavailable) {
        old--; // safe to remove: the ready count stays at or above n - maxUnavailable
        stopped++;
      } else break;
    }
    rows.push({ t: tick, old, new: newReady, starting: starting.length, ready: old + newReady,
      total: old + newReady + starting.length, started, stopped });
    if (old === 0 && newReady === n) return rows;
    starting = starting.map((x) => x - 1); // time passes: boot and readiness checks progress
    newReady += starting.filter((x) => x <= 0).length;
    starting = starting.filter((x) => x > 0);
  }
  throw new Error("rollout did not finish");
}

function verify(rows, n, maxSurge, maxUnavailable) {
  for (const r of rows) {
    if (r.total > n + maxSurge) throw new Error(`too many servers at t=${r.t}`);
    if (r.ready < n - maxUnavailable) throw new Error(`capacity below the allowed minimum at t=${r.t}`);
  }
  const last = rows[rows.length - 1];
  if (last.new !== n || last.old !== 0) throw new Error("rollout incomplete");
  return [Math.min(...rows.map((r) => r.ready)), Math.max(...rows.map((r) => r.total))];
}

const N = 6, DELAY = 2, NEEDED = 5; // 6 servers, 2 s until ready, demand needs 5 ready servers
for (const [surge, unavailable] of [[1, 0], [0, 1], [2, 2], [0, 0]]) {
  const label = `surge=${surge} unavailable=${unavailable}`;
  let rows;
  try {
    rows = plan(N, surge, unavailable, DELAY);
  } catch (e) {
    if (surge === 0 && unavailable === 0) { console.log(`${label}: rejected (no progress possible)`); continue; }
    throw e;
  }
  const [low, high] = verify(rows, N, surge, unavailable);
  if (surge === 1 && unavailable === 0) {
    for (const r of rows) {
      console.log(`t=${String(r.t).padStart(2)} v1=${r.old} v2=${r.new} starting=${r.starting} ready=${r.ready} total=${r.total} +${r.started} -${r.stopped}`);
    }
  }
  const mixed = rows.filter((r) => r.old > 0 && r.new > 0).length;
  console.log(`${label}: ${rows.length} ticks, min ready=${low}, max servers=${high}, mixed-version ticks=${mixed}, keeps ${NEEDED} ready: ${low >= NEEDED}`);
}

// Blue-green needs no step plan: start N green servers, wait, flip the router once.
console.log(`blue-green: peak servers=${2 * N}, ready after ${DELAY} ticks, mixed-version ticks=0, rollback=1 router flip`);
