// Back-of-the-envelope estimation: turn a few stated assumptions into requests per second, storage and bandwidth.
// Everything is whole-number arithmetic, so JavaScript, Python and C# print exactly the same text.
// Units are decimal (1 KB = 1,000 bytes), which is close enough for an estimate and easy to do in your head.
const DAILY_USERS = 10_000_000;
const ACTIONS_PER_USER_PER_DAY = 2; // photo uploads
const KB_PER_ACTION = 500; // a photo after the app compresses it
const PEAK_FACTOR = 3; // the busiest moment runs at about 3 times the daily average
const YEARS_KEPT = 1;

const SECONDS_PER_DAY_ROUNDED = 100_000; // rounded up from 86,400 so division is easy
const SECONDS_PER_DAY_EXACT = 86_400;
const DAYS_PER_YEAR = 365;
const KILO = 1000; // each unit step (KB to MB to GB ...) is a factor of 1,000
const BITS_PER_BYTE = 8; // links are rated in bits per second, files are measured in bytes
const LINK_KBPS = 10_000_000; // one 10 Gbps network link, in kilobits per second
const BYTE_UNITS = ["KB", "MB", "GB", "TB", "PB", "EB"];
const BIT_UNITS = ["Kbps", "Mbps", "Gbps", "Tbps"];

// The latency ladder in nanoseconds: rough orders of magnitude, not measurements of any one machine.
const LADDER = [
  ["Read from memory", 100],
  ["Random read from an SSD", 100_000],
  ["Round trip inside one data centre", 500_000],
  ["Round trip to another region", 100_000_000],
];

const roundDiv = (a, b) => Math.floor((2 * a + b) / (2 * b)); // a / b rounded to the nearest whole number
const commas = (n) => n.toLocaleString("en-US");

function human(value, units) {
  // Pick the largest unit that keeps the number at 1 or more, and show up to two decimals.
  let unit = 0, scale = 1;
  while (unit < units.length - 1 && value >= scale * KILO) { scale *= KILO; unit++; }
  const hundredths = roundDiv(value * 100, scale);
  const whole = Math.floor(hundredths / 100), frac = hundredths % 100;
  const text = frac === 0 ? `${whole}` : frac % 10 === 0 ? `${whole}.${frac / 10}` : `${whole}.${String(frac).padStart(2, "0")}`;
  return `${text} ${units[unit]}`;
}

function time(ns) {
  if (ns >= 1_000_000) return `${ns / 1_000_000} ms`;
  if (ns >= 1_000) return `${ns / 1_000} us`;
  return `${ns} ns`;
}

console.log(`Assumptions: ${commas(DAILY_USERS)} daily users, ${ACTIONS_PER_USER_PER_DAY} actions each, ${KB_PER_ACTION} KB per action, peak ${PEAK_FACTOR}x, kept ${YEARS_KEPT} year`);

const perDay = DAILY_USERS * ACTIONS_PER_USER_PER_DAY;
console.log(`requests per day: ${commas(DAILY_USERS)} x ${ACTIONS_PER_USER_PER_DAY} = ${commas(perDay)}`);

const averageQps = roundDiv(perDay, SECONDS_PER_DAY_ROUNDED);
const exactQps = roundDiv(perDay, SECONDS_PER_DAY_EXACT);
const roundingErrorPercent = roundDiv(100 * (SECONDS_PER_DAY_ROUNDED - SECONDS_PER_DAY_EXACT), SECONDS_PER_DAY_ROUNDED);
console.log(`average per second (${commas(SECONDS_PER_DAY_ROUNDED)} s a day): ${commas(averageQps)}`);
console.log(`average per second (${commas(SECONDS_PER_DAY_EXACT)} s a day): ${commas(exactQps)}`);
console.log(`rounding the day costs about ${roundingErrorPercent}%`);

const peakQps = averageQps * PEAK_FACTOR;
console.log(`peak per second: ${commas(averageQps)} x ${PEAK_FACTOR} = ${commas(peakQps)}`);

const storagePerDayKb = perDay * KB_PER_ACTION;
const storageKb = storagePerDayKb * DAYS_PER_YEAR * YEARS_KEPT;
console.log(`storage per day: ${human(storagePerDayKb, BYTE_UNITS)}`);
console.log(`storage for ${YEARS_KEPT} year: ${human(storageKb, BYTE_UNITS)}`);

const peakKbPerSecond = peakQps * KB_PER_ACTION;
const peakKbps = peakKbPerSecond * BITS_PER_BYTE;
console.log(`peak bandwidth: ${human(peakKbPerSecond, BYTE_UNITS)}/s = ${human(peakKbps, BIT_UNITS)}`);
console.log(`share of one 10 Gbps link: ${roundDiv(100 * peakKbps, LINK_KBPS)}%`);

console.log("latency ladder:");
const memoryNs = LADDER[0][1];
for (const [name, ns] of LADDER) console.log(`  ${name.padEnd(34)} ${time(ns).padStart(6)} = ${commas(ns / memoryNs)}x memory`);
