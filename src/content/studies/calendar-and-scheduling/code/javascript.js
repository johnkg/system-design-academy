// A calendar core in JavaScript: a weekly series stored once as a rule in wall time plus a time zone, expanded only inside the
// window a reader asks for (with a cancelled and a moved occurrence), free/busy by merging busy intervals, and a room that
// rejects overlapping bookings the way an exclusion constraint does. Times are whole minutes since 1970-01-01 UTC.

const DAY = 1440, HOUR = 60;

// Calendar arithmetic on day numbers (days since 1970-01-01), so no library or machine time zone is involved.
function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400), yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468;
}
function civilFromDays(z) {
  z += 719468;
  const era = Math.floor(z / 146097), doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153), d = doy - Math.floor((153 * mp + 2) / 5) + 1, m = mp + (mp < 10 ? 3 : -9);
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}
const weekday = (days) => (days + 4) % 7; // 0 = Sunday; 1970-01-01 was a Thursday
const nthSunday = (y, m, n) => { const first = daysFromCivil(y, m, 1); return first + ((7 - weekday(first)) % 7) + 7 * (n - 1); };
const lastSunday = (y, m) => { const last = daysFromCivil(y, m + 1, 1) - 1; return last - weekday(last); };

// Two zones with today's rules: the start and end of summer time as UTC instants for a given year.
const ZONES = {
  'America/New_York': { std: -5 * HOUR, dst: -4 * HOUR, // second Sunday of March 02:00 local to first Sunday of November 02:00 local
    range: (y) => [nthSunday(y, 3, 2) * DAY + 7 * HOUR, nthSunday(y, 11, 1) * DAY + 6 * HOUR] },
  'Europe/London': { std: 0, dst: HOUR, // last Sunday of March 01:00 UTC to last Sunday of October 01:00 UTC
    range: (y) => [lastSunday(y, 3) * DAY + HOUR, lastSunday(y, 10) * DAY + HOUR] },
};
function offsetAt(zone, utc) {
  const z = ZONES[zone], [start, end] = z.range(civilFromDays(Math.floor(utc / DAY))[0]);
  return utc >= start && utc < end ? z.dst : z.std;
}
// Wall time to UTC. A time that happens twice means the first one; a time skipped by the clock change is read with the
// offset from before the gap, so it lands one hour later (both as RFC 5545 says).
function toUtc(zone, local) {
  const z = ZONES[zone];
  for (const off of [z.dst, z.std]) if (offsetAt(zone, local - off) === off) return local - off;
  return local - z.std;
}
const pad = (n) => String(n).padStart(2, '0');
const date = (t) => { const [y, m, d] = civilFromDays(Math.floor(t / DAY)); return `${y}-${pad(m)}-${pad(d)}`; };
const clock = (t) => { const m = ((t % DAY) + DAY) % DAY; return `${pad(Math.floor(m / HOUR))}:${pad(m % HOUR)}`; };
const inZone = (zone, utc) => utc + offsetAt(zone, utc);
const local = (y, m, d, h, min = 0) => daysFromCivil(y, m, d) * DAY + h * HOUR + min;

// The series: stored once, never copied into rows. EXDATE cancels an occurrence; an override replaces one, keyed by its original start.
const series = {
  zone: 'America/New_York', start: local(2026, 3, 2, 9), minutes: 60, everyDays: 7, count: 6,
  exdates: new Set([local(2026, 3, 16, 9)]),
  overrides: new Map([[local(2026, 3, 23, 9), { start: local(2026, 3, 23, 10) }]]),
};
// Expand only the occurrences that touch [from, to). Steps are taken in wall time, then each one is converted to UTC.
function expand(s, from, to) {
  const out = [];
  for (let i = 0; i < s.count; i++) {
    const original = s.start + i * s.everyDays * DAY;
    if (s.exdates.has(original)) continue;
    const startLocal = s.overrides.has(original) ? s.overrides.get(original).start : original;
    const start = toUtc(s.zone, startLocal), end = start + s.minutes;
    if (start < to && end > from) out.push({ start, end, moved: s.overrides.has(original) });
  }
  return out;
}

console.log('series: Mondays 09:00 America/New_York from 2026-03-02, 6 times, 2026-03-16 cancelled, 2026-03-23 moved to 10:00');
const naiveUtc = toUtc(series.zone, series.start); // the mistake: keep the first instant and add 7 days of UTC
const from = local(2026, 3, 9, 0), to = local(2026, 4, 6, 0);
const instances = expand(series, from, to);
for (const x of instances) {
  const weeks = Math.floor((x.start - naiveUtc + (7 * DAY) / 2) / (7 * DAY)), wrong = naiveUtc + weeks * 7 * DAY;
  console.log(`${date(x.start)} New York ${clock(inZone(series.zone, x.start))}, UTC ${clock(x.start)}, London ${clock(inZone('Europe/London', x.start))}; ` +
    (x.moved ? 'moved by an override' : `stored as one UTC instant: ${clock(inZone(series.zone, wrong))} in New York`));
}
const gap = toUtc('America/New_York', local(2026, 3, 8, 2, 30));
console.log(`2026-03-08 02:30 does not exist in New York: read as ${clock(inZone('America/New_York', gap))} local, ${clock(gap)} UTC`);

// Free/busy on Monday 9 March: each calendar's busy intervals (UTC), merged, then gaps of at least 60 minutes in 09:00-17:00 New York.
const day = daysFromCivil(2026, 3, 9) * DAY, at = (h, m = 0) => day + h * HOUR + m;
const busy = {
  Alice: [...instances.filter((x) => x.start < at(24)).map((x) => [x.start, x.end]), [at(15), at(16)]],
  Ben: [[at(14, 30), at(15, 30)], [at(17), at(18)]],
  'Room 4B': [[at(19), at(20)]],
};
const all = Object.values(busy).flat().sort((a, b) => a[0] - b[0]);
const merged = [];
for (const [s, e] of all) {
  const last = merged[merged.length - 1];
  if (last && s <= last[1]) last[1] = Math.max(last[1], e); else merged.push([s, e]);
}
const workFrom = toUtc('America/New_York', local(2026, 3, 9, 9)), workTo = toUtc('America/New_York', local(2026, 3, 9, 17)), need = 60;
const free = [];
let cursor = workFrom;
for (const [s, e] of merged) { if (s - cursor >= need) free.push([cursor, s]); cursor = Math.max(cursor, e); }
if (workTo - cursor >= need) free.push([cursor, workTo]);
const ny = (t) => clock(inZone('America/New_York', t));
console.log(`busy intervals: ${all.length}, merged: ${merged.map(([s, e]) => `${ny(s)}-${ny(e)}`).join(' ')} (New York)`);
console.log(`free for ${need} min: ${free.map(([s, e]) => `${ny(s)}-${ny(e)}`).join(' ')}`);

// Room 4B: three bookings arrive together. Ranges are half-open [start, end), so 11:00-12:00 does not clash with 10:00-11:00.
const midnight = toUtc('America/New_York', local(2026, 3, 10, 0)); // Tuesday 10 March
const requests = [['Dana', 10, 11], ['Eli', 10.5, 11.5], ['Fay', 11, 12]].map(([who, a, b]) => ({ who, start: midnight + a * HOUR, end: midnight + b * HOUR }));
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
// Read then write: all three check the same empty snapshot, then all insert.
let clashes = 0;
for (let i = 0; i < requests.length; i++) for (let j = i + 1; j < requests.length; j++) if (overlaps(requests[i], requests[j])) clashes++;
console.log(`read then write: ${requests.length} booked, ${clashes} overlapping pairs`);
// Exclusion constraint: the database checks each insert against the rows already committed, one at a time.
const table = [], results = [];
for (const r of requests) {
  const hit = table.find((b) => overlaps(b, r));
  if (hit) results.push(`${r.who} rejected (overlaps ${hit.who})`); else { table.push(r); results.push(`${r.who} booked`); }
}
console.log(`exclusion constraint: ${results.join(', ')}`);

if (clashes === 0 || table.length !== 2 || free.length !== 3) process.exit(1);
