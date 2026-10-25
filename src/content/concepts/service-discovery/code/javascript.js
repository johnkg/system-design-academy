// Service discovery: an orders service calls a payment service whose instances scale and crash. Deterministic, integers only.
// One step is 1 second. Instances register with a lease (TTL 30 s) and renew it with a heartbeat every 10 s. Orders sends 30
// requests per second, round-robin over the payment addresses it currently knows. A call to an address whose instance is gone fails.
const HORIZON = 600, RATE = 30;
const TTL = 30, HEARTBEAT = 10, DRAIN = 5; // a stopping instance deregisters 5 s before it exits
const DNS_TTL = 30, IGNORED_TTL = 300, PUSH_DELAY = 1;
const INSTANCES = [ // [name, start second, end second (-1 = runs to the end), how it ends]
  ["p1", 0, -1, "runs"], ["p2", 0, 155, "crash"], ["p3", 0, 383, "crash"], ["p4", 60, 300, "stop"],
  ["p5", 60, 515, "crash"], ["p6", 245, -1, "runs"], ["p7", 420, -1, "runs"], ["p8", 470, -1, "runs"],
];
const alive = (x, t) => x[1] <= t && (x[2] < 0 || t < x[2]);

function run(mode, retry) {
  const registry = new Map(); // name -> second of the last renewal
  let view = [], pending = [], counter = 0, failed = 0, sentToDead = 0;
  const lastSeen = new Map(); // dead instance -> last second the caller still listed it
  for (let t = 0; t < HORIZON; t++) {
    for (const x of INSTANCES) {
      const draining = x[3] === "stop" && t >= x[2] - DRAIN;
      if (!alive(x, t) || draining) continue; // a crashed instance simply goes silent
      if (t === x[1] || (t - x[1]) % HEARTBEAT === 0) registry.set(x[0], t); // register, then renew the lease
    }
    for (const x of INSTANCES) if (x[3] === "stop" && t === x[2] - DRAIN) registry.delete(x[0]); // clean deregistration
    for (const [name, last] of [...registry]) if (t - last >= TTL) registry.delete(name); // the lease ran out
    const current = [...registry.keys()].sort();

    if (mode === "static" && t === 0) view = ["p1", "p2", "p3"]; // written into a config file once
    if (mode === "dns" && t % DNS_TTL === 0) view = current; // the cached answer expires with the record's TTL
    if (mode === "dns-ignoring-ttl" && t % IGNORED_TTL === 0) view = current; // the client keeps answers for 5 minutes
    if (mode === "watch") { view = t === 0 ? current : pending; pending = current; } // pushed changes arrive 1 s later

    for (let r = 0; r < RATE; r++) {
      const i = counter++ % view.length;
      if (alive(INSTANCES.find((x) => x[0] === view[i]), t)) continue;
      sentToDead++;
      if (retry && alive(INSTANCES.find((x) => x[0] === view[(i + 1) % view.length]), t)) continue; // another instance answers
      failed++;
    }
    for (const name of view) if (!alive(INSTANCES.find((x) => x[0] === name), t)) lastSeen.set(name, t);
  }
  const notice = INSTANCES.filter((x) => x[3] === "crash").map((x) => {
    const last = lastSeen.get(x[0]);
    if (last === undefined) return `${x[0]}:never-listed`; // the caller never knew this instance existed
    if (last === HORIZON - 1) return `${x[0]}:never`;
    return `${x[0]}:${last - x[2] + 1}s`;
  });
  return { failed, sentToDead, notice: notice.join(" ") };
}

const modes = [["static", false], ["dns", false], ["dns-ignoring-ttl", false], ["watch", false], ["watch", true]];
const results = [];
for (const [mode, retry] of modes) {
  const r = run(mode, retry);
  results.push(r);
  console.log(`${(mode + (retry ? "+retry" : "")).padEnd(17)} failed=${r.failed} sent_to_dead=${r.sentToDead} crash_noticed_after=${r.notice}`);
}

const check = (ok, msg) => { if (!ok) { console.error("assertion failed: " + msg); process.exit(1); } };
const [stat, dns, ignoring, watch, watchRetry] = results;
check(watch.failed < dns.failed && dns.failed < ignoring.failed && ignoring.failed < stat.failed, "fresher lists fail less");
check(watchRetry.failed === 0 && watchRetry.sentToDead === watch.sentToDead, "a retry hides the stale entry but does not remove it");
console.log("failed requests out of", HORIZON * RATE, "sent");
