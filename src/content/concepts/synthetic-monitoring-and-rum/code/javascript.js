// Synthetic probes with an N-of-M rule, and the p75 of a RUM sample, on one seeded day of 1440 minutes.
const DAY = 1440, FAULT_START = 180, FAULT_END = 360, BRAZIL = 4;
let state = 9;

function rand(n) { // small integer LCG so every language prints the same numbers
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return (state >>> 16) % n;
}

// The world is drawn once, in a fixed order, so every probe setting sees the same day.
const blip = Array.from({ length: 5 }, () => new Array(DAY).fill(0));  // 1 = single-probe network blip (0.4%)
const fails = Array.from({ length: 5 }, () => new Array(DAY).fill(0)); // 1 = a probe in the faulted region fails (90%)
for (let t = 0; t < DAY; t++) {
  for (let loc = 0; loc < 5; loc++) {
    blip[loc][t] = rand(1000) < 4 ? 1 : 0;
    fails[loc][t] = rand(100) < 90 ? 1 : 0;
  }
}

function synthetic(interval, locations, need) {
  need = Math.min(need, locations);
  const latest = new Array(locations).fill(null); // { failed, real } from each location's latest check
  let detect = -1, falseAlarms = 0, checks = 0, wasFalse = false;
  for (let t = 0; t < DAY; t++) {
    let ran = false;
    for (let k = 0; k < locations; k++) {
      const offset = Math.floor((k * interval) / locations); // staggered start per location
      if (t >= offset && (t - offset) % interval === 0) {
        ran = true; checks++;
        const real = k === BRAZIL && t >= FAULT_START && t < FAULT_END && fails[k][t] === 1;
        latest[k] = { failed: real || blip[k][t] === 1, real };
      }
    }
    if (!ran) continue;
    const failing = latest.filter((s) => s && s.failed);
    const met = failing.length >= need;
    const causedByFault = failing.some((s) => s.real);
    if (met && causedByFault && detect < 0) detect = t - FAULT_START;
    const isFalse = met && !causedByFault;
    if (isFalse && !wasFalse) falseAlarms++;
    wasFalse = isFalse;
  }
  return [detect, falseAlarms, checks];
}

function p75(values) { // nearest rank: the ceil(0.75 * n)-th smallest
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((3 * s.length + 3) / 4) - 1];
}

function rumDay(samplingPct) {
  const perMinute = [];
  for (let t = 0; t < DAY; t++) {
    const slow = t >= FAULT_START && t < FAULT_END;
    const minute = [];
    for (let v = 0; v < 40; v++) {                  // 40 Brazil page views per minute
      if (rand(100) < samplingPct) {                // the sampling decision
        const lcp = 900 + rand(800) + rand(800);    // 900..2500 ms, about 1.7 s median
        minute.push(slow ? lcp * 3 : lcp);
      }
    }
    perMinute.push(minute);
  }
  return perMinute;
}

function rumDetect(perMinute) { // 15-minute window, at least 20 samples, p75 above 4000 ms
  for (let t = 15; t < DAY; t++) {
    const window = perMinute.slice(t - 15, t).flat();
    if (window.length >= 20 && p75(window) > 4000) return t - FAULT_START;
  }
  return -1;
}

const results = {};
for (const [interval, locations, need] of [[5, 3, 1], [5, 5, 1], [5, 5, 2], [1, 5, 1], [15, 5, 1], [1, 5, 3]]) {
  const [d, f, c] = synthetic(interval, locations, need);
  console.log(`every ${String(interval).padStart(2)} min, ${locations} locations, need ${need}: detected after ${d >= 0 ? d : "never"}, false alarms ${f}, checks ${c}`);
  results[`${interval},${locations},${need}`] = [d, f];
}

const days = rumDay(10);
const fault = days.slice(FAULT_START, FAULT_END).flat();
const normal = days.slice(0, FAULT_START).flat();
const mean = Math.floor(fault.reduce((a, b) => a + b, 0) / fault.length);
console.log(`RUM at 10%: normal p75 ${p75(normal)} ms, outage p75 ${p75(fault)} ms, outage mean ${mean} ms`);
console.log(`RUM alert after ${rumDetect(days)} min with 10% sampling, after ${rumDetect(rumDay(1))} with 1%`);

function check(ok, message) { if (!ok) { console.error("assertion failed: " + message); process.exit(1); } }
const r = (k) => results[k];
check(r("5,3,1")[0] === -1, "no probe in Brazil: the regional fault is invisible");
check(r("5,5,1")[0] >= 0 && r("5,5,1")[0] < 5, "a Brazil probe, any 1: found within one interval");
check(r("5,5,2")[0] === -1 || r("5,5,2")[0] > r("5,5,1")[0], "2 of 5 hides a one-region fault");
check(r("1,5,3")[0] === -1 && r("1,5,3")[1] === 0, "3 of 5 never fires on blips or on one region");
check(r("1,5,1")[1] > r("5,5,1")[1] && r("5,5,1")[1] > r("15,5,1")[1], "shorter interval, more false alarms");
check(p75(normal) < 2500 && 4000 < p75(fault), "p75 moves from good to poor");
check(rumDetect(days) >= 0 && rumDetect(days) < 30 && rumDetect(rumDay(1)) === -1, "1% sampling is too thin to alert");
console.log("ok");
