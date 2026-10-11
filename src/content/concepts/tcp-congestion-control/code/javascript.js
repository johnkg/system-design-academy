// A round-by-round model of TCP Reno (slow start + AIMD) on a fixed-capacity link.
// One loop iteration = one round trip: the sender puts cwnd segments in flight.
// All integer arithmetic, a seeded Park-Miller generator, no clock.
const MSS = 1460, INITIAL_WINDOW = 10;

function makeRng(seed) {
  let s = seed;
  return () => { s = (s * 48271) % 2147483647; return s; };
}

function transfer(fileBytes, mbps, rttMs, bufferSegs, lossPer10k, seed) {
  const bdp = Math.floor((mbps * 125 * rttMs) / MSS); // bytes per RTT / MSS = segments needed in flight to fill the link
  const total = Math.ceil(fileBytes / MSS);
  const rng = makeRng(seed);
  let cwnd = INITIAL_WINDOW, ssthresh = 1000000000;
  let remaining = total, delivered = 0, timeMs = 0, retransmits = 0;
  const trace = [];
  while (remaining > 0) {
    const sent = Math.min(cwnd, remaining);
    const overflow = Math.max(0, sent - bdp - bufferSegs); // queue full: tail drop
    let random = 0;
    for (let i = 0; i < sent; i++) if (rng() % 10000 < lossPer10k) random++;
    const lost = Math.min(sent, overflow + random);
    // Invariant: more than BDP + buffer in flight cannot fit, so a loss event must follow.
    if (sent > bdp + bufferSegs && lost === 0) throw new Error("window above BDP+buffer without a loss");
    const queue = Math.min(Math.max(sent - bdp, 0), bufferSegs);
    let roundMs = rttMs + Math.floor((queue * rttMs) / bdp); // a standing queue inflates the RTT
    trace.push(cwnd + (lost > 0 ? "*" : ""));
    remaining -= sent - lost; // lost segments stay in "remaining" and are sent again
    delivered += sent - lost;
    retransmits += lost;
    if (lost > 0) {
      ssthresh = Math.max(2, Math.floor(cwnd / 2));
      if (sent - lost < 4) { cwnd = 1; roundMs += Math.max(200, 3 * rttMs); } // too few dup ACKs: timeout
      else cwnd = ssthresh;                                                   // fast retransmit + fast recovery
    } else if (cwnd < ssthresh) cwnd = Math.min(cwnd * 2, ssthresh); // slow start: double per RTT
    else cwnd += 1;                                                 // congestion avoidance: +1 per RTT
    timeMs += roundMs;
  }
  if (delivered !== total) throw new Error("transfer incomplete");
  return { bdp, total, rounds: trace.length, timeMs, retransmits, trace };
}

for (const [name, loss] of [["clean link", 0], ["0.1% random loss", 10], ["1% random loss", 100]]) {
  const r = transfer(5000000, 100, 80, 684, loss, 7); // 100 Mbit/s, 80 ms RTT, buffer = 1 BDP
  console.log(`${name}: BDP=${r.bdp} segments, file=${r.total} segments`);
  console.log(`  cwnd per round: ${r.trace.slice(0, 14).join(" ")}${r.rounds > 14 ? " ..." : ""}`);
  console.log(`  rounds=${r.rounds} time=${r.timeMs} ms retransmits=${r.retransmits}`);
}
console.log(`ideal time at line rate: ${Math.floor((5000000 * 8) / 100000)} ms`); // 100 Mbit/s = 100000 bits per ms
