// Reliable delivery over a lossy network, tick by tick, in JavaScript:
// numbered segments, cumulative acknowledgements, in-order delivery and retransmission.
// This is a teaching model of what TCP does, not real networking code.

const TOTAL = 5;      // segments 0 to 4
const LATENCY = 1;    // ticks for a packet to cross the network
const TIMEOUT = 4;    // ticks before the sender resends an unacknowledged segment
const lostFirstTime = new Set([2]); // the network drops segment 2 the first time it is sent

const inFlight = [];  // packets travelling: { arriveAt, kind, n }
const sentAt = new Array(TOTAL).fill(null);
const attempts = new Array(TOTAL).fill(0);
const received = new Set();
let nextToDeliver = 0; // receiver: the next segment the application is waiting for
let acked = 0;         // sender: everything below this has been acknowledged

function transmit(tick, segment) {
  sentAt[segment] = tick;
  attempts[segment]++;
  const label = attempts[segment] > 1 ? "resends" : "sends";
  if (attempts[segment] === 1 && lostFirstTime.has(segment)) {
    console.log(`tick ${tick}: sender ${label} segment ${segment} -> LOST in the network`);
  } else {
    console.log(`tick ${tick}: sender ${label} segment ${segment}`);
    inFlight.push({ arriveAt: tick + LATENCY, kind: "data", n: segment });
  }
}

for (let tick = 0; tick <= 11; tick++) {
  // Packets that arrive on this tick
  for (const packet of inFlight.filter((p) => p.arriveAt === tick)) {
    if (packet.kind === "data") {
      received.add(packet.n);
      const delivered = [];
      while (received.has(nextToDeliver)) delivered.push(nextToDeliver++);
      console.log(`tick ${tick}: receiver gets ${packet.n}, delivers [${delivered}] to the application`);
      inFlight.push({ arriveAt: tick + LATENCY, kind: "ack", n: nextToDeliver }); // "I have everything below n"
    } else {
      acked = Math.max(acked, packet.n);
    }
  }

  // The sender sends one new segment per tick, and resends the oldest unacknowledged one after a timeout
  if (tick < TOTAL) transmit(tick, tick);
  else if (acked < TOTAL && sentAt[acked] !== null && tick - sentAt[acked] >= TIMEOUT) transmit(tick, acked);
}

console.log(`delivered in order: ${nextToDeliver} of ${TOTAL} segments`);
console.log("UDP would have delivered [0,1,3,4] immediately and never delivered 2");
