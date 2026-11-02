// A miniature of Chubby, Google's lock service (OSDI 2006), in JavaScript (a teaching model, not Google's code):
// clients hold sessions kept alive by KeepAlive calls and lease timeouts, a lock is released only when its holder's session
// expires, a lock holder can hand a sequencer to the servers it talks to so that a delayed request from an old holder is
// refused, and a client rides out a master fail-over by keeping its session during a grace period. Everything is deterministic.

const LEASE = 12; // seconds a KeepAlive extends a session lease (the paper's default)
const cell = { holder: null, generation: 0, sessions: new Map() };

function keepAlive(client, now) { cell.sessions.set(client, now + LEASE); }
function expireSessions(now) {
  for (const [client, end] of [...cell.sessions]) {
    if (end > now) continue;
    cell.sessions.delete(client);
    console.log(`t=${now}: ${client}'s session lease ran out (it ended at ${end})`);
    if (cell.holder === client) { cell.holder = null; console.log(`t=${now}: the lock held by ${client} is released`); }
  }
}
function acquire(client, now) {
  if (cell.holder !== null) return null;
  cell.holder = client; cell.generation++;
  console.log(`t=${now}: ${client} acquires the lock, sequencer generation ${cell.generation}`);
  return { generation: cell.generation }; // the sequencer a holder passes along with its requests
}

// Two file servers receive writes. One ignores sequencers; the other checks them against the newest generation it has seen.
const naive = { data: '' };
const checking = { data: '', newest: 0 };
function write(client, sequencer, value, now) {
  naive.data = value;
  if (sequencer.generation < checking.newest) {
    console.log(`t=${now}: ${client}'s write with generation ${sequencer.generation} is refused by the checking server (newest seen: ${checking.newest})`);
    return;
  }
  checking.newest = sequencer.generation; checking.data = value;
  console.log(`t=${now}: ${client}'s write with generation ${sequencer.generation} accepted`);
}

console.log('--- a stalled lock holder');
keepAlive('A', 0);
const seqA = acquire('A', 0);
write('A', seqA, 'A-data', 1);
keepAlive('A', 5); // A's last KeepAlive; then it stalls
console.log('t=5: A stalls (a long pause) and stops sending KeepAlive calls');
for (let t = 6; t <= 16; t++) expireSessions(t); // nothing happens: A's lease is still running, so the lock stays with A
expireSessions(17);
keepAlive('B', 17);
const seqB = acquire('B', 17);
write('B', seqB, 'B-data', 17);
write('A', seqA, 'A-late-data', 30);
console.log(`file server that ignores sequencers holds: ${naive.data}`);
console.log(`file server that checks sequencers holds: ${checking.data}`);

console.log('--- a master fail-over and the grace period');
function failover(grace) {
  const leaseEnd = 40, newMasterAt = 44; // the client's lease ends at 40; a new master is elected 6 seconds after the old one failed
  const jeopardy = leaseEnd; // the client empties its cache and waits
  const deadline = leaseEnd + grace;
  const survived = newMasterAt <= deadline;
  console.log(`grace period ${grace}s: lease ends at ${leaseEnd}, client in jeopardy, new master at ${newMasterAt}, deadline ${deadline} -> session ${survived ? 'kept, its locks survive' : 'lost, its locks are gone'}`);
  return jeopardy;
}
failover(45);
failover(3);
