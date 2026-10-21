// Rollups and an alert rule with a "for" duration in JavaScript:
// raw samples are squeezed into coarser buckets for long-term storage, and an alert only fires when a problem lasts.

// Turn many raw samples into one value per bucket, so months of history stay small.
function rollup(samples, bucketSeconds, aggregate) {
  const buckets = new Map();
  for (const { t, value } of samples) {
    const key = Math.floor(t / bucketSeconds) * bucketSeconds;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(value);
  }
  return [...buckets].map(([t, values]) => ({ t, value: aggregate(values) }));
}
const average = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const maximum = (v) => Math.max(...v);

// An alert rule is a small state machine: ok -> pending (condition true, but not for long enough yet) -> firing.
function evaluate(samples, threshold, forSeconds) {
  let state = 'ok', since = 0;
  const events = [];
  for (const { t, value } of samples) {
    if (value > threshold) {
      if (state === 'ok') { state = 'pending'; since = t; }
      if (state === 'pending' && t - since >= forSeconds) { state = 'firing'; events.push(`${t}s firing`); }
    } else {
      if (state === 'firing') events.push(`${t}s resolved`);
      state = 'ok';
    }
  }
  return events;
}

const SAMPLES = 40;
const SCRAPE_S = 15; // seconds between readings
const SPIKE_AT = 60;
const SPIKE_CPU = 97;
const INCIDENT_FROM = 300;
const INCIDENT_TO = 420;
const INCIDENT_CPU = 90;
const BASE_CPU = 40; // normal load wobbles 40, 43, 46
const WOBBLE_STEPS = 3;
const WOBBLE_PCT = 3;
const MINUTE_S = 60;
const HOUR_S = 60 * MINUTE_S;
const THRESHOLD = 80; // alert when CPU is above 80%
const ALERT_FOR_S = 60; // for at least this long

// Ten minutes of CPU readings, one every 15 seconds: a one-sample spike at 60 s, and a real problem from 300 s to 420 s.
const samples = Array.from({ length: SAMPLES }, (_, i) => {
  const t = i * SCRAPE_S;
  const value = (t === SPIKE_AT) ? SPIKE_CPU : (t >= INCIDENT_FROM && t <= INCIDENT_TO) ? INCIDENT_CPU : BASE_CPU + (i % WOBBLE_STEPS) * WOBBLE_PCT;
  return { t, value };
});

const minutes = rollup(samples, MINUTE_S, maximum);
console.log(`${samples.length} raw samples became ${minutes.length} one-minute points (max per minute)`);
console.log(`hourly average CPU: ${rollup(samples, HOUR_S, average)[0].value.toFixed(1)}`);

const noisy = evaluate(samples, THRESHOLD, 0);
const calm = evaluate(samples, THRESHOLD, ALERT_FOR_S);
console.log(`alert without a duration: ${noisy.join(', ')}`);
console.log(`alert that must last 60 s: ${calm.join(', ')}`);
if (noisy.length !== 4 || calm.length !== 2) process.exit(1); // the spike alone must not page anyone, the real problem must
