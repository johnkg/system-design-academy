// Checks that the slider defaults of a case study's estimator agree with the numbers its own prompt states.
//
// A study's prompt, functional and non-functional requirements say how big the system is ("50,000 hosts", "hundreds of thousands
// of checks per second"). The estimator that follows lets the reader change those quantities, and its defaults should reproduce
// the scale of the prompt. Reviews of the site found about a dozen defaults that did not (a default of 20,000 hosts beside a
// prompt that says 50,000), so this reads both and reports a slider whose default is far from a quantity the text states for the
// same thing.
//
// How it matches: a quantity in the text is a number of 1,000 or more ("50,000", "2 million", "10k") or a magnitude phrase
// ("hundreds of thousands", "millions"), together with the few words that follow it ("hosts", "checks per second"). A slider
// matches when its label shares a noun with those words. A slider is reported when it matches at least one quantity and its
// default is within none of them: more than a factor of two from a stated number, or outside a stated range by more than a
// factor of two. It cannot judge sliders the text does not name, so it complements the review, it does not replace it.
//
// It is an AUDIT, not a gate: the matching is by words, so it also lists sliders that only share a noun with a requirement (a
// "files cached per client" slider beside "90,000 clients"). Read each line and decide. On the site as it stood before the
// reviews it found 2 of the defaults that were later corrected by hand (20,000 hosts against a prompt of 50,000; 2,000 webhook
// events per second against 10,000), beside about 25 lines that were not drift, so it is not run in CI.
// Usage: npm run audit:estimators   (node scripts/check-estimators.mjs [--strict] [--root <dir>])
//   --strict   exit 1 when any slider is listed (for trying it on a branch)
//   --root     audit another checkout, for testing
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const rootArg = args.includes('--root') ? args[args.indexOf('--root') + 1] : null;
const repo = rootArg ?? new URL('..', import.meta.url).pathname;
const FACTOR = 2; // how far a default may sit from a stated quantity
const MIN_QUANTITY = 1000; // smaller numbers are too often something else (a count of steps, a percentage)

const SCALE_WORDS = { hundred: 1e2, hundreds: 1e2, thousand: 1e3, thousands: 1e3, k: 1e3, million: 1e6, millions: 1e6, m: 1e6, billion: 1e9, billions: 1e9, b: 1e9, trillion: 1e12, trillions: 1e12 };
const RANGE_PHRASES = [
  ['hundreds of thousands', 1e5, 1e6], ['tens of thousands', 1e4, 1e5], ['hundreds of millions', 1e8, 1e9], ['tens of millions', 1e7, 1e8],
  ['hundreds of billions', 1e11, 1e12], ['tens of billions', 1e10, 1e11], ['thousands', 1e3, 1e4], ['millions', 1e6, 1e7], ['billions', 1e9, 1e10],
];
// Words that say how a quantity is counted rather than what it counts: they never make two phrases about the same thing.
const GENERIC = new Set(['peak', 'average', 'avg', 'per', 'second', 'sec', 'minute', 'min', 'hour', 'day', 'month', 'year', 'week', 'the', 'of', 'a', 'an', 'and', 'or', 'to', 'in', 'on', 'at', 'for', 'with', 'new', 'active', 'total', 'number', 'count', 'rate', 'share', 'size', 'time', 'each', 'every', 'all', 'most', 'more', 'than', 'that', 'is', 'are', 'by', 'from', 'about', 'around', 'up', 'over', 'under', 'typical', 'daily', 'monthly', 'hourly', 'live', 'concurrent', 'many']);
const stem = (w) => w.toLowerCase().replace(/[^a-z]/g, '').replace(/(ies)$/, 'y').replace(/(es|s)$/, '');
const nouns = (text) => new Set(text.split(/\s+/).map(stem).filter((w) => w.length > 2 && !GENERIC.has(w)));
const fmt = (n) => (n >= 1e9 ? `${+(n / 1e9).toFixed(2)} billion` : n >= 1e6 ? `${+(n / 1e6).toFixed(2)} million` : n.toLocaleString('en-US'));

// Seconds in one unit of time, for turning "50 million a day" into a rate per second.
const PER = { second: 1, sec: 1, minute: 60, min: 60, hour: 3600, day: 86400, month: 2592000 };
const rateOf = (text) => { const m = text.match(/\b(?:per|a|each|\/)\s*(second|sec|minute|min|hour|day|month)\b/i); return m ? PER[m[1].toLowerCase()] : null; };

// Every quantity in a text: { lo, hi, words, rate, phrase }. `rate` is the seconds in the time unit when it is a rate ("a day"), else null.
function quantities(text) {
  const out = [];
  const clean = text.replace(/\s+/g, ' ');
  const add = (lo, hi, after, phrase) => {
    const firstWords = after.split(/\s+/).slice(0, 3).join(' ');
    out.push({ lo, hi, words: nouns(firstWords), rate: rateOf(after.split(/\s+/).slice(0, 8).join(' ')), phrase });
  };
  for (const m of clean.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|trillion|k|m|b)?\b(?![\d%.])/gi)) {
    const raw = m[1].replace(/,/g, '');
    if (!raw || /^0\d/.test(raw)) continue;
    const value = parseFloat(raw) * (m[2] ? SCALE_WORDS[m[2].toLowerCase()] : 1);
    if (!(value >= MIN_QUANTITY)) continue;
    const after = clean.slice(m.index + m[0].length, m.index + m[0].length + 70).split(/[.;:()]/)[0];
    // a unit straight after the number means it is not a count of things (ms, KB, GB, Gbps, %)
    if (/^\s*(ms|s|kb|mb|gb|tb|pb|gbps|mbps|kbps|bytes|byte|b\/s|%|usd|\$|€)\b/i.test(after)) continue;
    if (/^\s*(post|engineering|paper|blog|rfc)\b/i.test(after)) continue; // a year or a reference, not a quantity
    add(value, value, after.trim(), `${m[0].trim()} ${after.trim().split(/\s+/).slice(0, 4).join(' ')}`.trim());
  }
  // The phrases are listed longest first, and a match is blanked out so "thousands" inside "hundreds of thousands" does not count again.
  let lower = clean.toLowerCase();
  for (const [phrase, lo, hi] of RANGE_PHRASES) {
    const re = new RegExp(`\\b${phrase}\\b(?: of)?\\s+([a-z-]+(?:\\s+[a-z-]+){0,6})`, 'g');
    for (const m of [...lower.matchAll(re)]) add(lo, hi, m[1], `${phrase} ${m[1].split(/\s+/).slice(0, 4).join(' ')}`);
    lower = lower.replace(new RegExp(`\\b${phrase}\\b`, 'g'), (x) => ' '.repeat(x.length));
  }
  return out;
}

// The sliders of an estimator that count things: label, default, a count scale given in the label ("(millions)"), and a rate unit.
// Percentages, shares, ratios and "per user" sliders say how the system behaves, not how big it is, so they are skipped.
function sliders(source) {
  const out = [];
  for (const m of source.matchAll(/<RangeField\b([^>]*?)\/>/gs)) {
    const attr = (name) => (m[1].match(new RegExp(`\\b${name}="([^"]*)"`)) ?? [])[1];
    const label = attr('label'), value = parseFloat(attr('value'));
    if (!label || Number.isNaN(value)) continue;
    if (/%|\bshare\b|\bratio\b|\bfraction\b|\bpercent/i.test(label)) continue;
    const parenthetical = (label.match(/\(([^)]*)\)/) ?? [])[1]?.toLowerCase().trim() ?? '';
    const bare = label.replace(/\([^)]*\)/g, ' ');
    const perMatches = [...bare.matchAll(/\bper\s+(\w+)/gi)].map((x) => x[1].toLowerCase());
    if (perMatches.some((u) => !(u in PER))) continue; // "per user", "per request": a ratio, not a size
    const scale = SCALE_WORDS[parenthetical.split(/\s+/)[0]] ?? 1;
    if (parenthetical && scale === 1 && /^(gb|tb|pb|mb|kb|ms|s|x|days?|hours?|minutes?|seconds?|months?|years?|bytes?|km|mbps|gbps|usd)\b/.test(parenthetical)) continue; // not a count
    const core = bare.split(/\bper\b|\bat\b|\bin\b|,/i)[0];
    out.push({ label, value: value * scale, words: nouns(core), rate: rateOf(bare) });
  }
  return out;
}

// A default is "within" a stated quantity when both are counts of the same kind (both per time unit, or both plain) and it is
// no more than FACTOR from the stated number, or from the edges of a stated range.
function within(slider, q) {
  const d = slider.rate ? slider.value / slider.rate : slider.value, lo = q.rate ? q.lo / q.rate : q.lo, hi = q.rate ? q.hi / q.rate : q.hi;
  return d >= lo / FACTOR && d <= hi * FACTOR;
}

export function findDrift(meta, estimatorSource) {
  const text = [meta.prompt, ...(meta.functional ?? []), ...(meta.nonFunctional ?? [])].join(' ');
  const qs = quantities(text);
  const problems = [];
  for (const s of sliders(estimatorSource)) {
    if (s.value < 10) continue; // too small to be a size of the system
    const matching = qs.filter((q) => !!q.rate === !!s.rate && [...q.words].some((w) => s.words.has(w)));
    if (!matching.length || matching.some((q) => within(s, q))) continue;
    problems.push({ label: s.label, def: s.value, rate: s.rate, quantity: matching[0] });
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const studies = join(repo, 'src', 'content', 'studies');
  let checked = 0, listed = 0;
  for (const slug of readdirSync(studies).sort()) {
    const metaFile = join(studies, slug, 'meta.json'), estFile = join(repo, 'src', 'studies', slug, 'Estimator.astro');
    if (!existsSync(metaFile) || !existsSync(estFile)) continue;
    checked++;
    for (const p of findDrift(JSON.parse(readFileSync(metaFile, 'utf8')), readFileSync(estFile, 'utf8'))) {
      listed++;
      const q = p.quantity, range = q.lo === q.hi ? fmt(q.lo) : `${fmt(q.lo)} to ${fmt(q.hi)}`;
      console.log(`REVIEW studies/${slug}: slider "${p.label}" defaults to ${fmt(p.def)}${p.rate ? ' per ' + Object.keys(PER).find((k) => PER[k] === p.rate) : ''}; the requirements say "${q.phrase}" (${range}${q.rate ? ' per ' + Object.keys(PER).find((k) => PER[k] === q.rate) : ''})`);
    }
  }
  console.log(`audited ${checked} estimators: ${listed} slider(s) to read against their requirements`);
  process.exit(strict && listed ? 1 : 0);
}
