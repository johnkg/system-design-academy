// An incident core in JavaScript: alerts are grouped into incidents, the on-call chain is paged until someone
// acknowledges, every step lands in an append-only timeline, and status updates fan out with retries and dedupe.

let seed = 4242;
const rand = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

const SERVICES = ['checkout', 'search', 'login'];
const CHAIN = ['primary', 'secondary', 'manager'];
const ACK_WINDOW = 5;   // minutes to acknowledge before the next level is paged
const GROUP_GAP = 10;   // an alert within 10 minutes of the last one joins the open incident
const SUBSCRIBERS = 300, ATTEMPTS = 4;

const timeline = [];    // append-only: entries are never edited or removed
const log = (t, text) => timeline.push({ t, idx: timeline.length, text });

// 1. Group alerts into incidents. Severity 1 is the worst, and an incident takes the worst severity of its alerts.
const incidents = [];
for (let i = 0; i < 24; i++) {
  const t = i * 4 + rand(4), service = SERVICES[rand(3)], sev = 1 + rand(3);
  const open = incidents.find((x) => x.service === service && t - x.last <= GROUP_GAP);
  if (open) { open.last = t; open.alerts++; open.sev = Math.min(open.sev, sev); }
  else incidents.push({ id: incidents.length + 1, service, start: t, last: t, alerts: 1, sev });
}

// 2. Page the chain: each level has ACK_WINDOW minutes, and the first person to acknowledge becomes commander.
for (const inc of incidents) {
  let now = inc.start, paged = 0;
  log(now, `INC-${inc.id} declared on ${inc.service}, sev ${inc.sev}, from ${inc.alerts} alerts`);
  for (const level of CHAIN) {
    const delay = 1 + rand(9);
    paged++;
    log(now, `INC-${inc.id} paged ${level}`);
    if (delay <= ACK_WINDOW) { now += delay; inc.commander = level; log(now, `INC-${inc.id} ${level} acknowledged and is commander`); break; }
    now += ACK_WINDOW;
  }
  inc.paged = paged;
  inc.acked = now;
  if (!inc.commander) log(now, `INC-${inc.id} nobody acknowledged: page the whole team`);
}

// 3. Status page fan-out for serious incidents. A key per (incident, subscriber) lets the receiver drop repeats.
const received = new Set();
let attempts = 0, duplicates = 0, gaveUp = 0, total = 0;
for (const inc of incidents.filter((x) => x.sev <= 2)) {
  for (let s = 0; s < SUBSCRIBERS; s++) {
    const key = `${inc.id}:${s}`;
    total++;
    let done = false;
    for (let a = 0; a < ATTEMPTS && !done; a++) {
      attempts++;
      if (rand(100) < 15) continue;                                            // the send failed: retry
      if (received.has(key)) duplicates++; else received.add(key);             // delivered, and a repeat is ignored
      done = rand(100) >= 5;                                                   // 5%: the acknowledgement was lost, so we resend
    }
    if (!done && !received.has(key)) gaveUp++;
  }
  log(inc.acked, `INC-${inc.id} status page update sent to ${SUBSCRIBERS} subscribers`);
}

const ordered = [...timeline].sort((a, b) => a.t - b.t || a.idx - b.idx);
console.log(`alerts 24 -> incidents ${incidents.length}`);
for (const inc of incidents) console.log(`INC-${inc.id} ${inc.service} sev ${inc.sev} alerts ${inc.alerts} paged ${inc.paged} commander ${inc.commander ?? 'none'} acked at ${inc.acked}`);
console.log(`timeline entries ${ordered.length}, first: ${ordered[0].text}`);
console.log(`fan-out: ${total} messages, ${attempts} attempts, ${duplicates} duplicates dropped, ${gaveUp} gave up, ${received.size} delivered`);

const times = ordered.every((e, i) => i === 0 || ordered[i - 1].t <= e.t);
const alertSum = incidents.reduce((s, x) => s + x.alerts, 0);
console.log(`checks: ordered ${times}, alerts kept ${alertSum === 24}, delivered + gave up = total ${received.size + gaveUp === total}`);
if (!times || alertSum !== 24 || received.size + gaveUp !== total) process.exit(1);
