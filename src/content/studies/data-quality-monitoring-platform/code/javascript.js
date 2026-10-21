// A volume check with a seasonality-aware baseline, and a circuit breaker, in JavaScript:
// a table's hourly row count is compared with the same hour of the week in earlier weeks, using median and MAD (integers only).

const SEED = 4242;
let seed = SEED;
// Linear congruential generator (Numerical Recipes constants), high 16 bits.
const random = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor(seed / 65536) % n; };

const HOURS_PER_WEEK = 168, WEEKS = 5, HOURS_PER_DAY = 24, DAYS_PER_WEEK = 7;
const WEEKEND_FIRST_DAY = 5, WEEKEND_PERCENT = 40; // days 5 and 6 are the weekend
const NOISE_MIN_PER_MILLE = 950, NOISE_STEPS = 101, PER_MILLE = 1000; // a factor of 0.950..1.050
// Incidents in the last week: an outage on day 2, 13:00-16:00, and a double load on day 4 at 03:00.
const OUTAGE_DAY = 2, OUTAGE_FIRST_HOUR = 13, OUTAGE_LAST_HOUR = 16, OUTAGE_PERCENT = 35;
// The incident: on this day and hour of the last week, a re-run job leaves four times the usual rows.
const RERUN_DAY = 4, RERUN_HOUR = 3, RERUN_FACTOR = 4;
const NAIVE_SIGMAS = 3, SEASONAL_SIGMAS = 4;
const MAD_TO_SIGMA_X100 = 148, MIN_SIGMA_PERCENT = 3; // sigma = 1.48 * MAD, at least 3% of the median
const FIXED_FLOOR = 200;
const OPEN_AFTER = 2, CLOSE_AFTER = 3; // breaker: alerting hours to open, healthy hours to close
// Rows loaded per hour (in thousands) for each hour of the day: quiet at night, busy in the afternoon.
const SHAPE = [120, 90, 70, 60, 60, 80, 150, 300, 520, 700, 820, 900, 880, 860, 900, 940, 880, 760, 600, 480, 380, 300, 220, 160];

const series = [], incident = [];
for (let t = 0; t < HOURS_PER_WEEK * WEEKS; t++) {
  const hour = t % HOURS_PER_DAY, day = Math.floor(t / HOURS_PER_DAY) % DAYS_PER_WEEK;
  let v = Math.floor((SHAPE[hour] * (day >= WEEKEND_FIRST_DAY ? WEEKEND_PERCENT : 100)) / 100); // weekends carry 40% of the weekday volume
  v = Math.floor((v * (NOISE_MIN_PER_MILLE + random(NOISE_STEPS))) / PER_MILLE);                // noise of about plus or minus 5%
  const week = Math.floor(t / HOURS_PER_WEEK);
  let bad = false;
  if (week === WEEKS - 1 && day === OUTAGE_DAY && hour >= OUTAGE_FIRST_HOUR && hour <= OUTAGE_LAST_HOUR) {
    // A source stops sending.
    v = Math.floor((v * OUTAGE_PERCENT) / 100); bad = true;
  }
  if (week === WEEKS - 1 && day === RERUN_DAY && hour === RERUN_HOUR) { v *= RERUN_FACTOR; bad = true; } // a job is re-run by mistake and loads the same rows again
  series.push(v); incident.push(bad);
}

const median = (xs) => { const a = [...xs].sort((p, q) => p - q), n = a.length; return n % 2 ? a[(n - 1) / 2] : Math.floor((a[n / 2 - 1] + a[n / 2]) / 2); };

// Naive baseline: the mean of everything, and three standard deviations (compared as squares, so no square root).
const history = series.slice(0, HOURS_PER_WEEK * (WEEKS - 1));
const mean = Math.floor(history.reduce((s, x) => s + x, 0) / history.length);
const variance = Math.floor(history.reduce((s, x) => s + (x - mean) * (x - mean), 0) / history.length);
const naiveFlag = (x) => (x - mean) * (x - mean) > NAIVE_SIGMAS * NAIVE_SIGMAS * variance;

// Seasonal baseline: the median of the same hour of the week in the 4 earlier weeks, with a spread from the MAD.
function seasonalFlag(t) {
  const same = [];
  for (let w = 1; w < WEEKS; w++) same.push(series[t - w * HOURS_PER_WEEK]);
  const med = median(same), mad = median(same.map((x) => Math.abs(x - med)));
  const sigma100 = Math.max(mad * MAD_TO_SIGMA_X100, med * MIN_SIGMA_PERCENT); // 1.48 * MAD estimates sigma, with a floor of 3% of the median (times 100)
  return Math.abs(series[t] - med) * 100 > SEASONAL_SIGMAS * sigma100;
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
const naive = score((t) => naiveFlag(series[t])), fixed = score((t) => series[t] < FIXED_FLOOR), seasonal = score(seasonalFlag);
console.log(`incidents: ${incident.filter(Boolean).length}; mean ${mean}, last-week low ${Math.min(...series.slice(start))}`);
console.log(`naive: hit ${naive.hit}, false alarms ${naive.falseAlarm}, missed ${naive.missed}`);
console.log(`fixed floor of 200: hit ${fixed.hit}, false alarms ${fixed.falseAlarm}, missed ${fixed.missed}`);
console.log(`seasonal: hit ${seasonal.hit}, false alarms ${seasonal.falseAlarm}, missed ${seasonal.missed}`);

// Circuit breaker: 2 alerting hours in a row open it (new hours are held back), 3 healthy hours in a row close it.
let open = false, bad = 0, good = 0, held = 0, opened = 0;
for (let t = start; t < series.length; t++) {
  const alert = seasonalFlag(t);
  if (alert) { bad++; good = 0; } else { good++; bad = 0; }
  if (!open && bad >= OPEN_AFTER) { open = true; opened++; }
  else if (open && good >= CLOSE_AFTER) open = false;
  if (open) held++;
}
console.log(`breaker opened ${opened} time(s), held back ${held} hour(s)`);
if (seasonal.hit <= naive.hit || seasonal.falseAlarm >= fixed.falseAlarm || seasonal.missed > 0 || open) process.exit(1);
