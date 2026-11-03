// A miniature of the commit-wait idea in the Spanner paper "Spanner: Google's Globally Distributed Database", in JavaScript
// (a teaching model, not Google's code): TrueTime returns an interval that is certain to contain the true time, a commit picks
// the latest end of that interval as its timestamp, and the commit waits until that timestamp has certainly passed. Without the
// wait, a transaction that starts after another has committed can be given an earlier timestamp. A snapshot read then reads
// the newest version at or below a timestamp, but only on a replica whose safe time has reached it.
// Everything is deterministic, so every run prints the same thing. All times are whole milliseconds and all numbers are made up.

const EPSILON = 12; // the uncertainty TrueTime advertises: every clock is within this of the true time
const OFFSET_A = 10; // coordinator A's clock runs this far ahead of true time
const OFFSET_B = -10; // coordinator B's clock runs this far behind: the two are 20 apart, within twice EPSILON
const PAXOS_MS = 5; // time for a Paxos commit

// TrueTime on a machine whose clock is `offset` ahead of true time `t`.
const now = (t, offset) => ({ earliest: t + offset - EPSILON, latest: t + offset + EPSILON });
const after = (t, offset, stamp) => now(t, offset).earliest > stamp; // true when stamp has definitely passed

// T1 reaches coordinator A at true time 100 and takes the latest end of its interval as its commit timestamp.
function commitFirst(commitWait) {
  const arrival = 100;
  const stamp = now(arrival, OFFSET_A).latest;
  let visible = arrival + PAXOS_MS; // when Paxos has finished
  if (commitWait) while (!after(visible, OFFSET_A, stamp)) visible++; // commit wait: nobody may see T1 until its stamp is in the past
  return { stamp, visible };
}

// T2 starts the moment T1 is visible and reaches coordinator B, whose clock is behind.
function commitSecond(startsAt) {
  return now(startsAt, OFFSET_B).latest;
}

function ordering(commitWait) {
  console.log(`--- ${commitWait ? 'with' : 'without'} commit wait`);
  const first = commitFirst(commitWait);
  const second = commitSecond(first.visible);
  const preserved = second > first.stamp;
  console.log(`T1 timestamp ${first.stamp}, visible to clients at ${first.visible}`);
  console.log(`T2 starts at ${first.visible}, timestamp ${second}: ${preserved ? 'ordered after T1' : 'ordered BEFORE T1, external consistency broken'}`);
  return { preserved, first, second };
}

// A versioned row: each write is stored at its commit timestamp. A snapshot read takes the newest version at or below its timestamp.
const versions = [{ at: 50, value: 10 }];
function snapshotRead(readAt, replicaSafeTime) {
  if (readAt > replicaSafeTime) return `waits: this replica is only up to date to ${replicaSafeTime}`;
  const hit = versions.filter((v) => v.at <= readAt).pop();
  return `reads ${hit.value} (the version written at ${hit.at}), no locks`;
}

const withoutWait = ordering(false);
const withWait = ordering(true);
versions.push({ at: withWait.first.stamp, value: 20 }, { at: withWait.second, value: 30 });

console.log('--- lock-free snapshot reads');
for (const readAt of [100, withWait.first.stamp, withWait.second]) console.log(`read at ${readAt}, replica up to date to ${withWait.second}: ${snapshotRead(readAt, withWait.second)}`);
console.log(`read at ${withWait.second}, replica up to date to ${withWait.first.stamp}: ${snapshotRead(withWait.second, withWait.first.stamp)}`);
const ok = !withoutWait.preserved && withWait.preserved && withWait.second > withWait.first.stamp;
console.log(`checks ${ok ? 'passed' : 'FAILED'}`);
if (!ok) process.exit(1);
