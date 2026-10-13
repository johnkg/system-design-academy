// An alerting pipeline in JavaScript:
// a rule fires only after its condition held for a while, then alerts are silenced, deduplicated, grouped into notifications and escalated.

let seed = 7;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

// 1. Rule evaluation: fire when the value has been above the threshold for `forMinutes` samples in a row.
function evaluate(samples, threshold, forMinutes) {
  const fires = [];
  let run = 0;
  samples.forEach((value, minute) => {
    run = value > threshold ? run + 1 : 0;
    if (run === forMinutes) fires.push(minute); // the moment it turns from pending into firing
  });
  return fires;
}
const samples = Array.from({ length: 120 }, () => random(100));
const quick = evaluate(samples, 60, 1).length, patient = evaluate(samples, 60, 3).length;
console.log(`rule value > 60 over 120 minutes: ${quick} fires with for=1, ${patient} fires with for=3`);

// 2. Firing alerts from three services, with many repeats of the same alert.
const SERVICES = ['checkout', 'search', 'batch'], NAMES = ['latency', 'errors'];
const raw = Array.from({ length: 400 }, (_, id) => ({ id, minute: random(120), service: SERVICES[random(3)], name: NAMES[random(2)], instance: random(8) }));
raw.sort((a, b) => a.minute - b.minute || a.id - b.id);

const silences = [{ service: 'batch', from: 30, to: 90 }]; // a maintenance window for the batch service
const DEDUPE_MINUTES = 10, GROUP_MINUTES = 10;
const lastSeen = new Map(), notifications = new Map();
let silenced = 0, duplicates = 0, fresh = 0;
for (const a of raw) {
  if (silences.some((s) => s.service === a.service && a.minute >= s.from && a.minute < s.to)) { silenced++; continue; }
  const fingerprint = `${a.name}/${a.service}/${a.instance}`;
  const previous = lastSeen.get(fingerprint);
  lastSeen.set(fingerprint, a.minute);
  if (previous !== undefined && a.minute - previous < DEDUPE_MINUTES) { duplicates++; continue; } // the same alert, still firing
  fresh++;
  const group = `${a.service}/${a.name}@${Math.floor(a.minute / GROUP_MINUTES)}`; // one notification per service, alert name and time slot
  notifications.set(group, (notifications.get(group) ?? 0) + 1);
}
console.log(`${raw.length} raw alerts: ${silenced} silenced, ${duplicates} duplicates, ${fresh} new`);
console.log(`${fresh} new alerts became ${notifications.size} notifications`);

// 3. Escalation: page the primary, and if nobody acknowledges, the secondary, and then the manager.
const ackChance = [60, 70, 100], pages = [0, 0, 0];
for (let n = 0; n < notifications.size; n++) {
  for (let level = 0; level < 3; level++) {
    pages[level]++;
    if (random(100) < ackChance[level]) break;
  }
}
const totalPages = pages[0] + pages[1] + pages[2];
console.log(`pages: primary ${pages[0]}, secondary ${pages[1]}, manager ${pages[2]}`);
console.log(`${raw.length} raw alerts became ${totalPages} pages, a reduction of ${Math.floor((100 * (raw.length - totalPages)) / raw.length)}%`);

const grouped = [...notifications.values()].reduce((a, b) => a + b, 0);
const ok = raw.length === silenced + duplicates + fresh && grouped === fresh && notifications.size <= fresh
  && pages[0] === notifications.size && pages[0] >= pages[1] && pages[1] >= pages[2] && patient <= quick;
if (!ok) process.exit(1);
