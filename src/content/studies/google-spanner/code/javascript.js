// A miniature of TrueTime and commit wait from Google's Spanner paper (OSDI 2012), in JavaScript (a teaching model, not Google's code).
// Each server's clock may be off by a few milliseconds, but the clock API returns an interval that is guaranteed to hold the true time.
// A write takes the latest end of that interval as its timestamp and, with commit wait, tells the client "done" only once that
// timestamp is certainly in the past. Without the wait, a write that starts after another one has finished can get an earlier timestamp.
// All times are whole milliseconds and everything is deterministic.

const EPSILON = 4; // uncertainty in ms; the paper says it is about 4 ms most of the time and generally under 10 ms
const SKEW = { X: 3, Y: -3 }; // how far each server's local clock is from true time (always within EPSILON)

const now = (server, trueTime) => { // TT.now(): an interval that is guaranteed to contain the true time
  const local = trueTime + SKEW[server];
  return { earliest: local - EPSILON, latest: local + EPSILON };
};

function write(versions, server, startTrue, value, wait) {
  const ts = now(server, startTrue).latest; // commit timestamp: no earlier than TT.now().latest
  let ackTrue = startTrue;
  if (wait) while (!(now(server, ackTrue).earliest > ts)) ackTrue++; // commit wait: until TT.after(ts) is true
  versions.push({ ts, value });
  return { ts, ackTrue };
}

function scenario(wait) {
  console.log(`--- commit wait ${wait ? 'on' : 'off'}, uncertainty +/-${EPSILON} ms`);
  const versions = [];
  const t1 = write(versions, 'X', 100, 'x=1', wait);
  console.log(`T1 on server X starts at 100, gets timestamp ${t1.ts}, client told "done" at ${t1.ackTrue} (waited ${t1.ackTrue - 100} ms)`);
  const t2 = write(versions, 'Y', t1.ackTrue + 1, 'x=2', wait);
  console.log(`T2 on server Y starts at ${t1.ackTrue + 1}, after T1 finished, and gets timestamp ${t2.ts}`);
  console.log(t2.ts > t1.ts ? 'timestamps follow real time: external consistency holds' : 'T2 started after T1 finished but has the EARLIER timestamp: external consistency broken');
  return versions;
}

function snapshotRead(versions, at) { // newest version at or before the timestamp, no locks
  const seen = versions.filter((v) => v.ts <= at).sort((a, b) => b.ts - a.ts)[0];
  console.log(`snapshot read at ${at}: ${seen ? seen.value : 'nothing yet'}`);
}

scenario(false);
const versions = scenario(true);
console.log('--- snapshot reads of the second run need no locks');
for (const at of [106, 107, 110, 111]) snapshotRead(versions, at);
