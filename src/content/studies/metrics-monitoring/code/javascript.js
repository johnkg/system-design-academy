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

// Ten minutes of CPU readings, one every 15 seconds: a one-sample spike at 60 s, and a real problem from 300 s to 420 s.
const samples = Array.from({ length: 40 }, (_, i) => {
  const t = i * 15;
  const value = (t === 60) ? 97 : (t >= 300 && t <= 420) ? 90 : 40 + (i % 3) * 3;
  return { t, value };
});

const minutes = rollup(samples, 60, maximum);
console.log(`${samples.length} raw samples became ${minutes.length} one-minute points (max per minute)`);
console.log(`hourly average CPU: ${rollup(samples, 3600, average)[0].value.toFixed(1)}`);

const noisy = evaluate(samples, 80, 0);
const calm = evaluate(samples, 80, 60);
console.log(`alert without a duration: ${noisy.join(', ')}`);
console.log(`alert that must last 60 s: ${calm.join(', ')}`);
if (noisy.length !== 4 || calm.length !== 2) process.exit(1); // the spike alone must not page anyone, the real problem must
