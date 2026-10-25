// Checks that the numbers quoted in each simulation's "how to try it" list can really be produced by that simulation.
//
// For every playground that has a numbered "how" list, the script opens the built page in a browser and drives the simulation:
// the defaults, every option of every select, the ends of every slider, and the settings each step names (a step that mentions
// the label "Shards" and the numbers 1 and 16 sets the Shards slider to 1 and to 16, alone and together with the earlier steps).
// Every number the list quotes must show up in the text of at least one of those states. A number that never shows up is a claim the reader
// cannot reproduce: the list may be out of date, or the step may rely on a click the script does not make.
//
// When a step's numbers never show, the script follows the steps up to it on a fresh page and presses the buttons it names.
// Some claims still cannot be reproduced (a sequence of clicks, a unit conversion, a figure the author derived by hand).
// Those are kept in scripts/walkthrough-baseline.json, so the check fails only for a NEW unverified number. Edit a how list so a
// number changes and the check asks you to look at it: fix the text, or run with --update to accept it on purpose.
//
// Usage (after `npm run build`): node scripts/check-walkthroughs.mjs [--only substring] [--update] [--verbose]
// Needs Playwright with a Chromium browser, like check:pages. Random numbers are seeded and animation is reduced, so a run is repeatable.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
const update = args.includes('--update');
const verbose = args.includes('--verbose');
const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'dist');
const baselinePath = join(root, 'scripts/walkthrough-baseline.json');
if (!existsSync(dist)) { console.error('No dist/ folder: run `npm run build` first.'); process.exit(2); }

const load = (id) => {
  for (const base of [root + '/', '/opt/node22/lib/node_modules/']) {
    try { return createRequire(base)(id); } catch { /* try the next place */ }
  }
  return null;
};
const playwright = load('playwright');
if (!playwright) { console.error('Playwright is not installed (npm install --no-save playwright).'); process.exit(2); }

const PORT_BASE = 4600, PORT_SPREAD = 300; // the preview server picks a port in this range
const START_TRIES = 60, START_POLL_MS = 500; // wait up to 30 s for the server
const PARALLEL = 4; // pages checked at once
const SETTLE_MS = 40; // pause between looks at a simulation that is redrawing after a control changes
const SETTLE_LOOKS = 25; // looks before giving up on a simulation that never stops changing (a running animation)
const MAX_STATES = 60; // states tried per simulation
const MIN_PLAIN = 10; // whole numbers below this are counts in prose ("3 copies", "step 2"), not claims
const APPROX_TOLERANCE = 0.05; // "about 300" may match 290 to 315
const APPROX_WORDS = /(about|around|roughly|nearly|almost|over|under|above|below|up to|at least|at most|more than|less than|~)\s*$/i;
const MIN_LABEL_WORD = 4; // a step names a control when it uses the label or any word of it this long
const SEED = 20261024;
const PRESSES = 6; // times each named button is pressed, with a look after each press ("press Send 3 times")

const port = PORT_BASE + Math.floor(Math.random() * PORT_SPREAD);
const origin = `http://127.0.0.1:${port}`;
const preview = spawn('npx', ['astro', 'preview', '--port', String(port), '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
const stop = () => { try { preview.kill('SIGTERM'); } catch { /* already gone */ } };
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(130); });
const base = (() => { try { return new URL(process.env.BASE ? `http://x${process.env.BASE}/` : origin + '/').pathname.replace(/\/$/, ''); } catch { return ''; } })();
{
  let up = false;
  for (let i = 0; i < START_TRIES && !up; i++) {
    try { up = (await fetch(origin + base + '/')).status < 500; } catch { await new Promise((r) => setTimeout(r, START_POLL_MS)); }
  }
  if (!up) { console.error('The preview server did not start.'); stop(); process.exit(2); }
}

// Every built page that has a "how" list.
const pages = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (entry === 'index.html' && readFileSync(path, 'utf8').includes('class="how')) pages.push('/' + relative(dist, join(path, '..')).replace(/\\/g, '/') + '/');
  }
})(dist);
pages.sort();
const wanted = pages.filter((p) => p.includes(only));

// Runs inside the page: drives one simulation and returns its "how" steps and every number it showed.
// mode 'explore' tries the controls; 'step' applies the settings of steps 0..step and then presses the buttons that step names
// (Run, Send, Publish...); 'buttons' presses every button from the defaults. Each press is followed by a look at the numbers.
async function drive({ index, settle, settleLooks, maxStates, minLabelWord, mode = 'explore', step = 0, presses = 0 }) {
  const section = document.querySelectorAll('section.playground')[index];
  const steps = [...section.querySelectorAll('ol.how > li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim());
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => (s || '').toLowerCase().replace(/[0-9%.,()]/g, ' ').replace(/\s+/g, ' ').trim();
  const labelOf = (el) => {
    const own = el.closest('label') ?? (el.id ? document.querySelector(`label[for="${el.id}"]`) : null);
    return clean(el.getAttribute('aria-label') || (own ? [...own.childNodes].filter((n) => n.nodeType === 3 || (n.nodeType === 1 && !/^(INPUT|SELECT|B|OUTPUT)$/.test(n.tagName))).map((n) => n.textContent).join(' ') : ''));
  };
  const controls = [...section.querySelectorAll('input[type=range], input[type=number], input[type=checkbox], input[type=radio], select')].filter((el) => !el.disabled).map((el) => {
    const kind = el.tagName === 'SELECT' ? 'select' : el.type;
    return { el, kind, label: labelOf(el), def: kind === 'checkbox' || kind === 'radio' ? el.checked : el.value };
  });
  const numbersIn = (text) => [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, ''))).filter((n) => Number.isFinite(n));
  const seen = new Set();
  const snapshot = () => {
    const copy = section.cloneNode(true);
    copy.querySelectorAll('ol.how, header, script, style').forEach((e) => e.remove());
    const live = [...section.querySelectorAll('input, select')].map((e) => (e.tagName === 'SELECT' ? e.selectedOptions[0]?.textContent : e.value)).join(' ');
    const aria = [...copy.querySelectorAll('[aria-label], [title]')].map((e) => `${e.getAttribute('aria-label') ?? ''} ${e.getAttribute('title') ?? ''}`).join(' ');
    numbersIn(`${copy.textContent} ${live} ${aria}`).forEach((n) => seen.add(n));
  };
  const fire = (el) => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const put = (c, value) => {
    try {
      if (c.kind === 'checkbox' || c.kind === 'radio') c.el.checked = !!value; else c.el.value = String(value);
      fire(c.el);
    } catch { /* a control that throws is reported by check:pages, not here */ }
  };
  // Wait until the simulation has stopped redrawing: its text is the same on two looks in a row. A fixed pause is too short on a busy machine.
  const stable = async () => {
    let last = '';
    for (let i = 0; i < settleLooks; i++) {
      await wait(settle);
      const now = section.textContent;
      if (now === last) return;
      last = now;
    }
  };
  const restore = () => controls.forEach((c) => put(c, c.def));
  let states = 0;
  const run = async (settings) => {
    if (states++ >= maxStates) return;
    settings.forEach(([c, v]) => put(c, v));
    await stable();
    snapshot();
  };

  // Buttons, in the order a step names them. Pressing one up to `presses` times shows counters that grow with each press.
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const buttons = [...section.querySelectorAll('button')].map((el) => ({ el, label: clean(el.textContent || el.getAttribute('aria-label')) })).filter((b) => b.label.length >= 3);
  const named = (text) => {
    const low = clean(text);
    return buttons.map((b) => ({ b, at: low.search(new RegExp(`\\b${escape(b.label)}\\b`)) })).filter((x) => x.at >= 0).sort((x, y) => x.at - y.at).map((x) => x.b);
  };
  const press = async (list) => {
    for (const b of list) {
      for (let i = 0; i < presses; i++) {
        if (b.el.disabled || !b.el.isConnected) break;
        b.el.click();
        await stable();
        snapshot();
      }
    }
  };

  snapshot();
  if (mode === 'buttons') {
    await press(buttons);
    return { steps, numbers: [...seen] };
  }
  // Each control on its own: every option, both ends of a slider, the other state of a box.
  if (mode === 'explore') for (const c of controls) {
    if (c.kind === 'select') for (const o of c.el.options) await run([[c, o.value]]);
    else if (c.kind === 'range' || c.kind === 'number') { if (c.el.min !== '') await run([[c, c.el.min]]); if (c.el.max !== '') await run([[c, c.el.max]]); }
    else await run([[c, !c.def]]);
    restore(); await stable();
  }
  // What each step names: a control whose label it mentions, an option whose text it mentions, and the numbers it quotes that fit a slider.
  const plan = steps.map((text) => {
    const low = text.toLowerCase();
    const quoted = numbersIn(text);
    const picks = [];
    for (const c of controls) {
      const mentioned = c.label.length >= 3 && (low.includes(c.label) || c.label.split(' ').some((w) => w.length >= minLabelWord && new RegExp(`\\b${w}`).test(low)));
      if (c.kind === 'select') {
        // An option is named by its text, or by all its longer words when the step fills in a placeholder ("Retry 3 times" for "Retry N times").
        const words = new Set(clean(text).split(' '));
        for (const o of c.el.options) {
          const t = clean(o.textContent), long = t.split(' ').filter((w) => w.length >= 3);
          if (t.length >= 3 && (low.includes(t) || (long.length >= 3 && long.every((w) => words.has(w))))) picks.push([[c, o.value]]);
        }
      } else if ((c.kind === 'range' || c.kind === 'number') && mentioned) {
        const min = Number(c.el.min || 0), max = Number(c.el.max || 0), step = Number(c.el.step || 1) || 1;
        for (const q of quoted) if (q >= min && q <= max) picks.push([[c, min + Math.round((q - min) / step) * step]]);
      } else if (c.kind === 'checkbox' && mentioned) picks.push([[c, true]]);
    }
    return picks;
  });
  if (mode === 'step') {
    // A step that names no button usually continues from the last one that did ("now switch to Unordered").
    let own = [];
    for (let k = step; k >= 0 && !own.length; k--) own = named(steps[k]);
    // The earlier steps' settings, then this step's settings one at a time and all together, pressing the buttons after each.
    const before = plan.slice(0, step).flat().flat();
    for (const p of [...plan[step], plan[step].flat()]) {
      restore();
      await run([...before, ...p]);
      await press(own);
    }
    return { steps, numbers: [...seen] };
  }
  const cumulative = [];
  for (const picks of plan) {
    for (const p of picks) await run(p); // the step on its own
    restore(); await stable();
    for (const p of picks) cumulative.push(...p);
    await run(cumulative.slice()); // and together with the earlier steps
  }
  return { steps, numbers: [...seen] };
}

// Which quoted numbers did the simulation never show?
function claims(text) {
  const out = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const before = text.slice(Math.max(0, m.index - 1), m.index);
    if (/[A-Za-z/_-]/.test(before)) continue; // part of a name such as p99, HTTP2 or v2
    const raw = m[0].replace(/,/g, '');
    const value = Number(raw);
    const decimals = raw.includes('.') ? raw.split('.')[1].length : 0;
    if (!Number.isFinite(value) || (!decimals && value < MIN_PLAIN)) continue;
    if (!decimals && value >= 1990 && value <= 2100) continue; // a year
    out.push({ raw: m[0], value, decimals, approx: APPROX_WORDS.test(text.slice(Math.max(0, m.index - 14), m.index)), at: m.index });
  }
  return out;
}
const shown = (c, numbers) => numbers.some((o) => c.decimals
  ? Math.abs(Math.round(o * 10 ** c.decimals) / 10 ** c.decimals - c.value) < 1e-9
  : o === c.value || (c.approx && Math.abs(o - c.value) <= APPROX_TOLERANCE * c.value));

const results = []; // one entry per simulation
async function check(path, context) {
  const page = await context.newPage();
  await page.addInitScript((seed) => {
    let s = seed >>> 0; // mulberry32, so every run draws the same "random" numbers
    Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }, SEED);
  await page.goto(origin + base + path, { waitUntil: 'load' });
  const count = await page.$$eval('section.playground', (s) => s.map((x) => !!x.querySelector('ol.how')));
  const opts = { settle: SETTLE_MS, settleLooks: SETTLE_LOOKS, maxStates: MAX_STATES, minLabelWord: MIN_LABEL_WORD, presses: PRESSES };
  const fresh = async () => page.goto(origin + base + path, { waitUntil: 'load' });
  let loaded = true;
  for (let i = 0; i < count.length; i++) {
    if (!count[i]) continue;
    if (!loaded) await fresh();
    loaded = false;
    const out = await page.evaluate(drive, { ...opts, index: i });
    const seen = new Set(out.numbers);
    const open = () => out.steps.map((text, k) => (claims(text).some((c) => !shown(c, [...seen])) ? k : -1)).filter((k) => k >= 0);
    // Numbers the controls alone never showed: follow each such step from a fresh page and press the buttons it names,
    // then, for whatever is still missing, press every button from the defaults.
    for (const k of open()) {
      await fresh();
      (await page.evaluate(drive, { ...opts, index: i, mode: 'step', step: k })).numbers.forEach((n) => seen.add(n));
    }
    if (open().length) {
      await fresh();
      (await page.evaluate(drive, { ...opts, index: i, mode: 'buttons' })).numbers.forEach((n) => seen.add(n));
    }
    results.push({ key: `${path}#${i}`, steps: out.steps, numbers: [...seen] });
  }
  await page.close();
}

const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });
const queue = [...wanted];
await Promise.all(Array.from({ length: PARALLEL }, async () => {
  while (queue.length) {
    const path = queue.shift();
    try { await check(path, context); } catch (e) { results.push({ key: `${path}#?`, steps: [], numbers: [], error: String(e).split('\n')[0] }); }
  }
}));
await browser.close();
stop();

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {};
const fresh = {}; // what the baseline would be after this run
const problems = [];
let total = 0;
for (const r of results.sort((a, b) => a.key.localeCompare(b.key))) {
  if (r.error) { problems.push(`${r.key}: could not be driven (${r.error})`); continue; }
  const missing = [];
  r.steps.forEach((text, i) => claims(text).forEach((c) => { total++; if (!shown(c, r.numbers)) missing.push({ step: i + 1, c, text }); }));
  if (missing.length) fresh[r.key] = [...new Set(missing.map((m) => m.c.raw))];
  const known = new Set(baseline[r.key] ?? []);
  for (const m of missing) {
    if (known.has(m.c.raw)) continue;
    const from = Math.max(0, m.c.at - 40);
    problems.push(`${r.key} step ${m.step}: "${m.c.raw}" is never shown by the simulation (…${m.text.slice(from, m.c.at + m.c.raw.length + 30)}…)`);
  }
  if (verbose) console.log(`${r.key}: ${r.steps.length} steps, ${r.numbers.length} numbers seen, ${missing.length} unverified`);
}
const stale = Object.entries(baseline).flatMap(([k, list]) => list.filter((n) => !(fresh[k] ?? []).includes(n)).map((n) => `${k}: "${n}"`));

if (update) {
  writeFileSync(baselinePath, JSON.stringify(Object.fromEntries(Object.entries(fresh).sort(([a], [b]) => a.localeCompare(b))), null, 1) + '\n');
  console.log(`Baseline written: ${Object.keys(fresh).length} simulations, ${Object.values(fresh).flat().length} numbers the check cannot reproduce.`);
  process.exit(0);
}
if (!only) for (const s of stale) console.warn(`warn  baseline entry no longer needed: ${s} (run with --update to tidy)`);
for (const p of problems) console.error(`ERROR ${p}`);
console.log(`checked ${total} numbers in ${results.length} how-to lists: ${problems.length} new unverified, ${Object.values(baseline).flat().length} known unverified in the baseline`);
process.exit(problems.length ? 1 : 0);
