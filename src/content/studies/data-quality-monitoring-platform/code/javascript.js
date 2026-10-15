// A volume check with a seasonality-aware baseline, and a circuit breaker, in JavaScript:
// a table's hourly row count is compared with the same hour of the week in earlier weeks, using median and MAD (integers only).

let seed = 4242;
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

const HOURS_PER_WEEK = 168, WEEKS = 5;
// Rows loaded per hour (in thousands) for each hour of the day: quiet at night, busy in the afternoon.
const SHAPE = [120, 90, 70, 60, 60, 80, 150, 300, 520, 700, 820, 900, 880, 860, 900, 940, 880, 760, 600, 480, 380, 300, 220, 160];

const series = [], incident = [];
for (let t = 0; t < HOURS_PER_WEEK * WEEKS; t++) {
  const hour = t % 24, day = Math.floor(t / 24) % 7;
  let v = Math.floor((SHAPE[hour] * (day >= 5 ? 40 : 100)) / 100); // weekends carry 40% of the weekday volume
  v = Math.floor((v * (950 + random(101))) / 1000);                // noise of about plus or minus 5%
  const week = Math.floor(t / HOURS_PER_WEEK);
  let bad = false;
  if (week === WEEKS - 1 && day === 2 && hour >= 13 && hour <= 16) { v = Math.floor((v * 35) / 100); bad = true; } // a source stops sending
  if (week === WEEKS - 1 && day === 4 && hour === 3) { v *= 4; bad = true; }                                     // a job loads the data twice
  series.push(v); incident.push(bad);
}

const median = (xs) => { const a = [...xs].sort((p, q) => p - q), n = a.length; return n % 2 ? a[(n - 1) / 2] : Math.floor((a[n / 2 - 1] + a[n / 2]) / 2); };

// Naive baseline: the mean of everything, and three standard deviations (compared as squares, so no square root).
const history = series.slice(0, HOURS_PER_WEEK * (WEEKS - 1));
const mean = Math.floor(history.reduce((s, x) => s + x, 0) / history.length);
const variance = Math.floor(history.reduce((s, x) => s + (x - mean) * (x - mean), 0) / history.length);
const naiveFlag = (x) => (x - mean) * (x - mean) > 9 * variance;

// Seasonal baseline: the median of the same hour of the week in the 4 earlier weeks, with a spread from the MAD.
function seasonalFlag(t) {
  const same = [];
  for (let w = 1; w < WEEKS; w++) same.push(series[t - w * HOURS_PER_WEEK]);
  const med = median(same), mad = median(same.map((x) => Math.abs(x - med)));
  const sigma100 = Math.max(mad * 148, med * 3);   // 1.48 * MAD estimates sigma, with a floor of 3% of the median (times 100)
  return Math.abs(series[t] - med) * 100 > 4 * sigma100;
}

const start = HOURS_PER_WEEK * (WEEKS - 1);
function score(flag) {
  let hit = 0, falseAlarm = 0, missed = 0;
  for (let t = start; t < series.length; t++) {
    const f = flag(t);
    if (f && incident[t]) hit++; else if (f) falseAlarm++; else if (incident[t]) missed++;
  }
  return { hit, falseAlarm, missed };
}
const naive = score((t) => naiveFlag(series[t])), fixed = score((t) => series[t] < 200), seasonal = score(seasonalFlag);
console.log(`incidents: ${incident.filter(Boolean).length}; mean ${mean}, last-week low ${Math.min(...series.slice(start))}`);
console.log(`naive: hit ${naive.hit}, false alarms ${naive.falseAlarm}, missed ${naive.missed}`);
console.log(`fixed floor of 200: hit ${fixed.hit}, false alarms ${fixed.falseAlarm}, missed ${fixed.missed}`);
console.log(`seasonal: hit ${seasonal.hit}, false alarms ${seasonal.falseAlarm}, missed ${seasonal.missed}`);

// Circuit breaker: 2 alerting hours in a row open it (new hours are held back), 3 healthy hours in a row close it.
let open = false, bad = 0, good = 0, held = 0, opened = 0;
for (let t = start; t < series.length; t++) {
  const alert = seasonalFlag(t);
  if (alert) { bad++; good = 0; } else { good++; bad = 0; }
  if (!open && bad >= 2) { open = true; opened++; }
  else if (open && good >= 3) open = false;
  if (open) held++;
}
console.log(`breaker opened ${opened} time(s), held back ${held} hour(s)`);
if (seasonal.hit <= naive.hit || seasonal.falseAlarm >= fixed.falseAlarm || seasonal.missed > 0 || open) process.exit(1);
