// Checks that the numbers quoted in each simulation's "how to try it" list can really be produced by that simulation.
//
// For every playground that has a numbered "how" list, the script opens the built page in a browser and drives the simulation:
// the defaults, every option of every select, the ends of every slider, and the settings each step names (a step that mentions
// the label "Shards" and the numbers 1 and 16 sets the Shards slider to 1 and to 16, alone and together with the earlier steps).
// Every number the list quotes must show up in the text of at least one of those states. A number that never shows up is a claim the reader
// cannot reproduce: the list may be out of date, or the step may rely on a click the script does not make.
//
// When a step's numbers never show, the script follows the steps up to it on a fresh page and presses the buttons it names.
// Then it reads the step as an ordered script, the way a reader follows it: "Press Reset, then set the rate to 400 thousand
// and the lag to 500 ms" becomes press Reset, set one slider, set another, with a look at the numbers after each action.
// Buttons are pressed by label, options chosen by their text, sliders and selects set to the number written after their label,
// text boxes typed into, boxes ticked. Only the part of a sentence before its colon is read as instructions (what follows is the
// result). A number the step tells the reader to type counts as shown once typed, since the control then displays it.
// If a number is still missing, a last phase tries RANDOM_STATES random settings of every control, pressing buttons now and then.
// Some claims still cannot be reproduced (a unit conversion, a figure the author derived by hand, a parameter inside the model).
// --scripts prints each step as the script it is replayed as, and every claim that counts as shown because a script typed it.
// Those are kept in scripts/walkthrough-baseline.json, so the check fails only for a NEW unverified number. Edit a how list so a
// number changes and the check asks you to look at it: fix the text, or run with --update to accept it on purpose.
//
// Usage (after `npm run build`): node scripts/check-walkthroughs.mjs [--only substring] [--update] [--verbose] [--shard 2/3]
// Needs Playwright with a Chromium browser, like check:pages. Random numbers are seeded and animation is reduced, so a run is repeatable.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseShard } from './shard.mjs';
import { BASELINE_CAP } from './baseline-cap.mjs';

const args = process.argv.slice(2);
const shard = parseShard(args);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
const update = args.includes('--update');
const verbose = args.includes('--verbose');
const scripts = args.includes('--scripts'); // print each step as the script it is replayed as
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
const RANDOM_STATES = 150; // random settings of every control tried for a simulation whose numbers are still missing
const RANDOM_PRESS_EVERY = 5; // after every this many random states, press the first buttons
const RANDOM_BUTTONS = 6; // how many buttons that press covers
const PRESSES = 6; // times each named button is pressed, with a look after each press ("press Send 3 times")

// A port nobody listens on: another checkout's preview server on the same port would be checked in place of this build.
const freePort = (p) => new Promise((resolve) => { const s = createServer().once('error', () => resolve(false)).listen(p, '127.0.0.1', () => s.close(() => resolve(true))); });
let port = 0;
for (let i = 0; i < PORT_SPREAD && !port; i++) { const p = PORT_BASE + Math.floor(Math.random() * PORT_SPREAD); if (await freePort(p)) port = p; }
if (!port) { console.error('No free port for the preview server.'); process.exit(2); }
const origin = `http://127.0.0.1:${port}`;
const preview = spawn('npx', ['astro', 'preview', '--port', String(port), '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
const stop = () => { try { preview.kill('SIGTERM'); } catch { /* already gone */ } };
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(130); });
const base = (() => { try { return new URL(process.env.BASE ? `http://x${process.env.BASE}/` : origin + '/').pathname.replace(/\/$/, ''); } catch { return ''; } })();
{
  let up = false;
  for (let i = 0; i < START_TRIES && !up; i++) {
    if (preview.exitCode !== null) break; // it could not start (the port was taken after all): do not check someone else's server
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
const wanted = shard.pick(pages.filter((p) => p.includes(only)));

// Runs inside the page: drives one simulation and returns its "how" steps and every number it showed.
// mode 'explore' tries the controls; 'step' applies the settings of steps 0..step and then presses the buttons that step names
// (Run, Send, Publish...); 'buttons' presses every button from the defaults. Each press is followed by a look at the numbers.
async function drive({ index, settle, settleLooks, maxStates, minLabelWord, mode = 'explore', step = 0, presses = 0, randomStates = 0, randomPressEvery = 1, randomButtons = 0, script = [], sweep = false }) {
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
    // Neighbouring elements run together in textContent ("783 of 3,100" next to "25.3%" reads as "3,10025.3"), so read the text a second time with a space between text nodes.
    const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
    const pieces = [];
    while (walker.nextNode()) pieces.push(walker.currentNode.textContent);
    numbersIn(`${copy.textContent} ${pieces.join(' ')} ${live} ${aria}`).forEach((n) => seen.add(n));
  };
  const fire = (el) => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const put = (c, value) => {
    try {
      if (c.kind === 'checkbox' || c.kind === 'radio') c.el.checked = !!value; else c.el.value = String(value);
      fire(c.el);
    } catch { /* a control that throws is reported by check:pages, not here */ }
  };
  // Wait until the simulation has stopped redrawing: its text is the same on two looks in a row. A fixed pause is too short on a busy machine.
  // Most simulations redraw in requestAnimationFrame, which a busy machine can hold back past the first look: wait for two frames first.
  const frames = () => Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))), wait(500)]); // a page whose frames never come still goes on
  const stable = async () => {
    await frames();
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

  // ---- Steps read as ordered scripts ----
  // 'parse' turns every step into actions in the order the text gives them: press a button (by its label, "twice" or
  // "3 times"), choose an option, set a slider or box to the number written after its label ("Raise the limit to 400",
  // "8 shards", "Lower the share to 50%"), tick a box, type into a text box ("set Query to red apple juice"). Only the
  // part of a sentence before its colon is read as instructions; what follows the colon is the result, from which only
  // an option named by its full text is taken ("compare intervals: every 1 min ..., every 15 min ..."). 'script' replays
  // a list of such actions from a fresh page and looks at the numbers after each one.
  const norm = (s) => (s || '').toLowerCase().replace(/[“”"]/g, '').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;
  const UNIT = String.raw`(%|(?:ms|s|secs?|seconds?|mins?|minutes?|h|hours?|days?|km|kb|mb|gb|tb|gbps|mbps|x|thousands?|millions?)(?![a-z]))?`;
  const toNum = (s) => Number(s.replace(/,/g, ''));
  const STOP = new Set(['that', 'this', 'with', 'from', 'when', 'what', 'than', 'then', 'only', 'each', 'into', 'over', 'under', 'after', 'before', 'first', 'every', 'other', 'still', 'there', 'their', 'which', 'where', 'while', 'never', 'always', 'without', 'more', 'less', 'most', 'some', 'have', 'been', 'were', 'they', 'also', 'same', 'once', 'none', 'both', 'second', 'seconds', 'minute', 'minutes', 'hours', 'percent', 'times', 'million', 'thousand']);
  const edge = (s, at, len) => !/[a-z0-9]/.test(s[at - 1] ?? '') && !/[a-z0-9]/.test(s[at + len] ?? '');
  const occurrences = (s, needle, prefix = false) => {
    const out = [];
    if (!needle) return out;
    for (let at = s.indexOf(needle); at >= 0; at = s.indexOf(needle, at + 1)) {
      if (prefix ? !/[a-z0-9]/.test(s[at - 1] ?? '') : edge(s, at, needle.length)) out.push(at);
    }
    return out;
  };
  const wordsOf = (s) => s.split(/[^a-z0-9'-]+/).map((w) => w.replace(/^[-']+|[-']+$/g, '')).filter(Boolean);
  const stem = (w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
  const rawLabel = (el) => {
    const own = el.closest('label') ?? (el.id ? document.querySelector(`label[for="${el.id}"]`) : null);
    return norm(el.getAttribute('aria-label') || (own ? [...own.childNodes].filter((n) => n.nodeType === 3 || (n.nodeType === 1 && !/^(INPUT|SELECT|TEXTAREA|B|OUTPUT)$/.test(n.tagName))).map((n) => n.textContent).join(' ') : ''));
  };
  const all = [...section.querySelectorAll('input, select')].filter((el) => !/^(hidden|button|submit|reset|file|color)$/.test(el.type)).map((el) => {
    const kind = el.tagName === 'SELECT' ? 'select' : /^(text|search|)$/.test(el.type) ? 'text' : el.type;
    const label = rawLabel(el);
    const base = label.replace(/\([^)]*\)/g, ' ').replace(/\s+\d[\d.,]*\s*[a-z%]*$/, '').replace(/\s+/g, ' ').trim(); // drop "(ms)" and a shown value after the label
    const units = [...label.matchAll(/\(([^)]*)\)/g)].flatMap((m) => wordsOf(m[1])).concat(label.includes('%') ? ['%'] : []);
    const words = [...new Set(wordsOf(base).filter((w) => w.length >= minLabelWord && !STOP.has(w) && !/^\d/.test(w)))];
    const options = kind === 'select' ? [...el.options].map((o) => {
      const full = norm(o.textContent);
      const n = full.match(new RegExp(`(${NUM})\\s*(%|[a-z]+)?`));
      return { value: o.value, full, head: full.split(/,|\s\(|:/)[0].trim(), num: n ? toNum(n[1]) : null, unit: n?.[2] ?? '', words: new Set(wordsOf(full).filter((w) => w.length >= 5 && !STOP.has(w))) };
    }) : [];
    return { el, kind, label, base, units, words, all: new Set(wordsOf(base)), options, def: kind === 'checkbox' || kind === 'radio' ? el.checked : el.value };
  });
  const fits = (c, v) => {
    const min = c.el.min === '' ? -Infinity : Number(c.el.min), max = c.el.max === '' ? Infinity : Number(c.el.max);
    const step = c.el.step === '' || c.el.step === 'any' ? 0 : Number(c.el.step);
    const off = step ? Math.abs((v - (Number.isFinite(min) ? min : 0)) / step - Math.round((v - (Number.isFinite(min) ? min : 0)) / step)) : 0;
    return v >= min && v <= max && off < 1e-6;
  };
  const numeric = (c) => c.kind === 'range' || c.kind === 'number';
  const unitMatch = (u, list) => !!u && list.some((x) => x === u || (u.length >= 2 && x.length >= 2 && (x.startsWith(u) || u.startsWith(x))));
  // A select's option named by a number ("shards to 8", "a 10 s wait", "5,000"): the option whose first number it is, with the unit if given.
  const numberOption = (c, v, unit) => {
    const hits = c.options.filter((o) => o.num === v);
    return (unit && hits.find((o) => unitMatch(unit, [o.unit]))) || hits[0] || null;
  };
  const buttonInfo = buttons.map((b) => ({ ...b, raw: norm(b.el.textContent || b.el.getAttribute('aria-label')) })).filter((b) => b.raw.length >= 3);
  const resets = buttonInfo.filter((b) => /^reset\b/.test(b.raw));
  const RESULT = /^(is|are|was|were|be|been|break|breaks|broke|fail|fails|failed|go|goes|went|get|gets|got|finish|finishes|finished|stay|stays|remain|remains|drop|drops|fall|falls|rise|rises|end|ends|wait|waits|give|gives|sit|sits|become|becomes|arrive|arrives|match|matches|hold|holds|run|runs|ones|now|still|already|lost|left|served|refused|rejected|dropped|blocked|kept|found|missed|missing)$/;
  // "up to 30 s" and "from 15.4 to 18.6" quote results, not settings.
  const APPROX = /(\bup|\d%?)\s+(to|at)$/;
  // "Lower the threshold to 3": the verb, then at most three words, then "to".
  const VERB_TO = /\b(set|raise|lower|push|cut|change|increase|decrease|reduce|move|put|bring|drag|slide|turn)(?:\s+[a-z'-]+){0,3}\s*$/;

  // Actions for one clause. `result` is the text after a colon: only options named in full are taken from it.
  const parseClause = (s, result) => {
    const found = []; // { at, end, act }
    const covered = (at, end) => found.some((f) => f.act.type === 'press' && at < f.end && end > f.at);
    const used = []; // spans of numbers already bound to a control
    const take = (at, end) => used.push([at, end]);
    const free = (at) => !used.some(([a, b]) => at >= a && at < b);
    // A word that names a control ("8 partitions", "consumers") does not also pick an option of another select by that word.
    const labelled = (at, end) => all.some((c) => [...c.words].some((w) => occurrences(s, stem(w), true).some((x) => /^s?(?![a-z0-9])/.test(s.slice(x + stem(w).length)) && at < x + stem(w).length && end > x)));
    for (const b of buttonInfo) for (const at of occurrences(s, b.raw)) {
      if (/without (pressing |clicking )?$/.test(s.slice(Math.max(0, at - 20), at))) continue;
      const m = s.slice(at + b.raw.length).match(/^\s*(twice|(\d+|two|three|four|five) times)/);
      const times = !m ? 1 : m[1] === 'twice' ? 2 : ({ two: 2, three: 3, four: 4, five: 5 })[m[2]] ?? Number(m[2]);
      found.push({ at, end: at + b.raw.length, act: { type: 'press', b: buttons.indexOf(buttons.find((x) => x.el === b.el)), times } });
    }
    if (resets.length) for (const at of occurrences(s, 'reset')) {
      if (covered(at, at + 5) || /without (pressing |clicking )?$/.test(s.slice(Math.max(0, at - 20), at))) continue;
      const r = resets.find((b) => b.raw === 'reset') ?? (resets.length === 1 ? resets[0] : null);
      if (r) found.push({ at, end: at + 5, act: { type: 'press', b: buttons.indexOf(buttons.find((x) => x.el === r.el)), times: 1 } });
    }
    all.forEach((c, ci) => {
      if (c.kind !== 'select') return;
      const hits = [];
      c.options.forEach((o, oi) => {
        if (/[a-z]{2}/.test(o.full)) for (const at of occurrences(s, o.full)) hits.push({ at, end: at + o.full.length, prio: 3, oi }); // not a bare number
        if (result) return;
        if (o.head.length >= 4 && o.head !== o.full && !/^\d/.test(o.head)) for (const at of occurrences(s, o.head)) hits.push({ at, end: at + o.head.length, prio: 2, oi });
      });
      if (!result) {
        // A word only some options share, outside the label: the most specific option that has it ("lockout", "backfill").
        const labelWords = new Set(wordsOf(c.label));
        const vocab = new Set(c.options.flatMap((o) => [...o.words]));
        for (const w of vocab) {
          if (labelWords.has(w)) continue;
          const holders = c.options.map((o, oi) => ({ o, oi })).filter(({ o }) => o.words.has(w));
          if (holders.length === c.options.length) continue;
          const fewest = Math.min(...holders.map(({ o }) => o.words.size));
          const smallest = holders.filter(({ o }) => o.words.size === fewest);
          if (smallest.length !== 1) continue;
          const pick = smallest[0];
          for (const at of occurrences(s, stem(w), true)) if (/^s?(?![a-z0-9])/.test(s.slice(at + stem(w).length)) && !labelled(at, at + stem(w).length)) hits.push({ at, end: at + stem(w).length, prio: 1, oi: pick.oi });
        }
      }
      hits.sort((x, y) => y.prio - x.prio || (y.end - y.at) - (x.end - x.at));
      const kept = [];
      for (const h of hits) if (!kept.some((k) => h.at < k.end && h.end > k.at) && !covered(h.at, h.end)) kept.push(h);
      for (const h of kept) found.push({ at: h.at, end: h.end, act: { type: 'set', c: ci, value: c.options[h.oi].value } });
    });
    if (!result) all.forEach((c, ci) => {
      const spans = [];
      if (c.base.length >= 3) for (const at of occurrences(s, c.base)) spans.push([at, at + c.base.length, true]);
      for (const w of c.words) for (const at of occurrences(s, stem(w), true)) spans.push([at, at + stem(w).length, false]);
      for (const [at, end, whole] of spans) {
        if (covered(at, end)) continue;
        if (c.kind === 'checkbox') {
          // The whole label, or a word of it right after "tick" ("tick only the classifier").
          if (!whole && !/\b(tick|untick|check|uncheck)\s+(?:[a-z]+\s+){0,2}$/.test(s.slice(0, at))) continue;
          const off = /\b(untick|uncheck|clear|turn off)\s+(the\s+)?$/.test(s.slice(Math.max(0, at - 16), at)) || /^\s+off\b/.test(s.slice(end));
          found.push({ at, end, act: { type: 'set', c: ci, value: !off } });
          continue;
        }
        found.push({ at, end, act: { type: 'mention', c: ci } });
        // Past the rest of the word and the label's other words ("Machines lost at once to 3").
        let restAt = end + s.slice(end).match(/^[a-z'-]*/)[0].length;
        for (let m; (m = s.slice(restAt).match(/^,?\s+([a-z'-]+)/)) && c.all.has(m[1]);) restAt += m[0].length;
        const gap = s.slice(restAt).match(/^\s*(?:\([^)]*\)\s*)?(?:(?:is|are|was)\s+)?(?:(?:set|back)\s+)?(to|at|on|=|every|:)?\s*/);
        const vAt = restAt + gap[0].length, rest = s.slice(vAt);
        if (c.kind === 'text') {
          const t = gap[1] === 'to' && rest.match(/^([^,;:.]+?)(?=\s+and\s|\s+then\s|\s+with\s|,|;|:|\.|$)/);
          if (t) found.push({ at, end, act: { type: 'set', c: ci, value: t[1].trim() } });
          continue;
        }
        if (c.kind === 'select') {
          const len = (x) => (rest.startsWith(x.full) && edge(rest, 0, x.full.length) ? x.full.length : x.head.length >= 2 && rest.startsWith(x.head) && edge(rest, 0, x.head.length) ? x.head.length : 0);
          const o = c.options.filter(len).sort((x, y) => len(y) - len(x))[0];
          if (o) { take(vAt, vAt + len(o)); found.push({ at, end, act: { type: 'set', c: ci, value: o.value } }); continue; }
        }
        const n = rest.match(new RegExp(`^\\$?(${NUM})(?![\\d]|:\\d)\\s*${UNIT}`)); // not a clock time such as 14:00
        // Only with a word that sets it ("limit to 400", "batch every 1 minute"): "scores 66" quotes a result.
        if (n && free(vAt) && gap[1] && gap[1] !== 'on') {
          const v = toNum(n[1].replace(/,$/, ''));
          if (numeric(c) && fits(c, v)) { take(vAt, vAt + n[0].length); found.push({ at, end, act: { type: 'set', c: ci, value: v } }); continue; }
          const o = c.kind === 'select' && numberOption(c, v, n[2]);
          if (o) { take(vAt, vAt + n[0].length); found.push({ at, end, act: { type: 'set', c: ci, value: o.value } }); continue; }
        }
        // A number written just before the label: "12 agents", "a 10 s wait", "20 per second".
        // Not when the label is followed by what happens to them ("0 connections break", "40 healthy ones are dropped").
        // Nor after "from", "in", "of"...: "drops from 400 to 300 requests", "104 hits in 200 requests" quote results.
        const before = s.slice(0, at).match(new RegExp(`(^|[^a-z0-9$.,]\\s*|\\b[a-z]+\\s+)\\$?(${NUM})\\s*${UNIT}\\s+(?:per\\s+)?$`));
        if (before && /^(to|from|in|of|than|by|about|around|nearly|over|under|only|all|and)\s+$/.test(before[1])) continue;
        const next = s.slice(restAt).match(/^\s*(?:\([^)]*\)\s*)?([a-z']+)?/)[1] ?? '';
        if (before && free(at - before[0].length + before[1].length) && !RESULT.test(next)) {
          const v = toNum(before[2].replace(/,$/, ''));
          const bAt = at - before[0].length + before[1].length;
          if (numeric(c) && fits(c, v)) { take(bAt, at); found.push({ at: bAt, end, act: { type: 'set', c: ci, value: v } }); continue; }
          const o = c.kind === 'select' && numberOption(c, v, before[3]);
          if (o) { take(bAt, at); found.push({ at: bAt, end, act: { type: 'set', c: ci, value: o.value } }); }
        }
      }
    });
    if (!result) {
      // A number no label claimed: "to 500 ms" or "at 8 km" sets the one slider measured in that unit; "Lower the threshold
      // to 3" sets the slider the step last named, or the only slider there is; so does "At 75" at the start of a clause.
      const sliders = all.map((c, ci) => ({ c, ci })).filter(({ c }) => numeric(c));
      for (const m of s.matchAll(new RegExp(`(?:^|\\b)(to|at) \\$?(${NUM})(?![\\d]|:\\d)\\s*${UNIT}`, 'g'))) {
        const vAt = m.index + m[0].indexOf(m[2]);
        if (!free(vAt) || APPROX.test(s.slice(Math.max(0, m.index - 14), m.index + m[1].length))) continue;
        const v = toNum(m[2].replace(/,$/, ''));
        let pick = null;
        const byUnit = sliders.filter(({ c }) => unitMatch(m[3], c.units) && fits(c, v));
        if (byUnit.length === 1) pick = byUnit[0];
        else if (m[3] && !sliders.some(({ c }) => unitMatch(m[3], c.units))) continue; // "At 25%" with no slider in % is a result
        else if ((m[1] === 'to' && VERB_TO.test(s.slice(0, m.index))) || (m[1] === 'at' && m.index === 0)) {
          const last = found.filter((f) => f.at < m.index && (f.act.type === 'mention' || f.act.type === 'set') && numeric(all[f.act.c]) && fits(all[f.act.c], v)).sort((x, y) => y.at - x.at)[0];
          const fitting = sliders.filter(({ c }) => fits(c, v));
          pick = last ? { ci: last.act.c } : fitting.length === 1 && sliders.length === 1 ? fitting[0] : null;
        }
        if (pick) { take(vAt, vAt + m[2].length); found.push({ at: m.index, end: vAt, act: { type: 'set', c: pick.ci, value: v } }); }
      }
      // An order typed into a form right after an option: "buy 200 at 10.10" fills the number boxes the values fit.
      const boxes = all.map((c, ci) => ({ c, ci })).filter(({ c }) => c.kind === 'number');
      for (const f of found.filter((x) => x.act.type === 'set' && all[x.act.c].kind === 'select')) {
        const m = s.slice(f.end).match(new RegExp(`^\\s+(${NUM})(?:\\s+(?:at|for|@)\\s+(${NUM}))?`));
        if (!m) continue;
        for (const raw of [m[1], m[2]].filter(Boolean)) {
          const v = toNum(raw), fit = boxes.filter(({ c }) => fits(c, v));
          if (fit.length === 1) found.push({ at: f.end + 1, end: f.end + 1, act: { type: 'set', c: fit[0].ci, value: v } });
        }
      }
    }
    return found.sort((x, y) => x.at - y.at).map((f) => f.act);
  };
  // Sentences, each split at its first colon outside brackets into instructions and result.
  const sentencesOf = (text) => text.split(/(?<=[.;!?])\s+(?=[A-Z0-9"“(])|;\s+/).map((sentence) => {
    const s = norm(sentence);
    let depth = 0, cut = -1;
    for (let i = 0; i < s.length && cut < 0; i++) { if (s[i] === '(') depth++; else if (s[i] === ')') depth--; else if (s[i] === ':' && depth <= 0) cut = i; }
    const head = cut < 0 ? s : s.slice(0, cut), tail = cut < 0 ? '' : s.slice(cut + 1);
    let acts = [...parseClause(head, false), ...parseClause(tail, true)];
    if (/\brepeat\b/.test(head)) acts = [...acts.filter((a) => a.type === 'press' && resets.some((r) => r.el === buttons[a.b]?.el)), ...acts.filter((a) => a.type !== 'press'), { type: 'repeat' }];
    return acts;
  });
  const parseSteps = () => {
    const parsed = steps.map(sentencesOf);
    let fallback = [];
    return parsed.map((sentences) => {
      // "Repeat from Reset with ..." presses again what the step pressed before it, Reset aside.
      const pressed = [];
      sentences = sentences.map((acts) => acts.flatMap((a) => {
        if (a.type !== 'repeat') { if (a.type === 'press' && !resets.some((r) => r.el === buttons[a.b]?.el)) pressed.push(a); return [a]; }
        return pressed.slice();
      }));
      const own = sentences.flat().filter((a) => a.type === 'press' && !resets.some((r) => r.el === buttons[a.b]?.el));
      // A step that names no button continues with the last one that did ("Set max unavailable to 2" after "Press Run").
      if (sentences.flat().some((a) => a.type === 'press')) fallback = own.length ? own.map((a) => ({ ...a, times: 1 })) : fallback;
      else sentences = sentences.map((acts) => (acts.some((a) => a.type === 'set') ? [...acts, ...fallback] : acts));
      return sentences.map((acts) => acts.filter((a) => a.type !== 'mention').filter((a, i, list) => !(i && JSON.stringify(a) === JSON.stringify(list[i - 1]))));
    });
  };
  if (mode === 'parse') {
    const parsed = parseSteps();
    // Numbers the scripts type into a slider or box, so a claim of the same number counts as shown: listed by --scripts for review.
    const typed = parsed.flatMap((sentences, k) => sentences.flat().filter((a) => a.type === 'set' && (numeric(all[a.c]) || all[a.c].kind === 'text')).map((a) => ({ step: k, value: a.value, label: all[a.c].label })));
    return { steps, parsed, typed };
  }
  if (mode === 'script') {
    const touched = new Set(script.filter((a) => a.type === 'set').map((a) => a.c));
    snapshot();
    for (const a of script) {
      if (a.type === 'press') {
        const b = buttons[a.b];
        for (let i = 0; i < a.times && b && !b.el.disabled && b.el.isConnected; i++) { b.el.click(); await stable(); snapshot(); }
      } else {
        const c = all[a.c];
        if (!c || c.el.disabled) continue;
        try {
          if (c.kind === 'checkbox' || c.kind === 'radio') c.el.checked = !!a.value; else c.el.value = String(a.value);
          fire(c.el);
        } catch { /* reported by check:pages */ }
        await stable(); snapshot();
      }
      // A step's numbers can hold across a choice it does not name (the day of a monitoring page): look at each option of those too.
      if (sweep) for (const c of all.filter((x, ci) => x.kind === 'select' && !touched.has(ci) && !x.el.disabled)) {
        const was = c.el.value;
        for (const o of c.options) { c.el.value = o.value; fire(c.el); await stable(); snapshot(); }
        c.el.value = was; fire(c.el); await stable();
      }
    }
    return { steps, numbers: [...seen] };
  }

  snapshot();
  if (mode === 'random') {
    let r = 12345; // a small seeded generator, so every run tries the same settings
    const rnd = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
    for (let n = 0; n < randomStates; n++) {
      const settings = controls.map((c) => {
        if (c.kind === 'select') return [c, c.el.options[Math.floor(rnd() * c.el.options.length)].value];
        if (c.kind === 'range' || c.kind === 'number') {
          const min = Number(c.el.min || 0), max = Number(c.el.max || 100), step = Number(c.el.step || 1) || 1;
          return [c, min + Math.round((rnd() * (max - min)) / step) * step];
        }
        return [c, rnd() < 0.5];
      });
      settings.forEach(([c, v]) => put(c, v));
      await stable();
      snapshot();
      if (n % randomPressEvery === 0) await press(buttons.slice(0, randomButtons));
    }
    return { steps, numbers: [...seen] };
  }
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
        const plain = clean(text), words = new Set(plain.split(/[^a-z-]+/));
        for (const o of c.el.options) {
          const t = clean(o.textContent), long = t.split(/[^a-z-]+/).filter((w) => w.length >= 3);
          if (t.length >= 3 && (low.includes(t) || plain.includes(t) || (long.length >= 3 && long.every((w) => words.has(w))))) picks.push([[c, o.value]]);
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
    // The earlier steps' settings, then each value this step names on its own, then with the step's first value for every
    // other control ("Own cell plus 8 neighbours" and a cell size of 1 km), then all of them in order, pressing the buttons after each.
    const before = plan.slice(0, step).flat().flat();
    const mine = plan[step].flat();
    const others = (c) => mine.filter(([o], i) => o !== c && mine.findIndex(([x]) => x === o) === i);
    for (const p of [...plan[step], ...plan[step].map((p) => [...others(p[0][0]), ...p]), mine]) {
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
    out.push({ raw: m[0].replace(/,$/, ''), value, decimals, approx: APPROX_WORDS.test(text.slice(Math.max(0, m.index - 14), m.index)), at: m.index });
  }
  return out;
}
const shown = (c, numbers) => numbers.some((o) => c.decimals
  ? Math.abs(Math.round(o * 10 ** c.decimals) / 10 ** c.decimals - c.value) < 1e-9
  : o === c.value || (c.approx && Math.abs(o - c.value) <= APPROX_TOLERANCE * c.value));

// Replays each step whose numbers are still missing as an ordered script, from a fresh page each time: the step alone, after
// the earlier steps (in full, or only their first sentence, which usually sets the scene), after each earlier step on its own,
// and each sentence of the step after one other sentence of it ("Switch to X: ... Put 12 agents on 1 customer: 496").
// Stops as soon as the step's numbers are all shown; a last round also looks at every option of the selects the script leaves alone.
async function replay(page, fresh, opts, i, seen, open) {
  await fresh();
  const { parsed } = await page.evaluate(drive, { ...opts, index: i, mode: 'parse' });
  if (scripts) parsed.forEach((sentences, k) => console.log(`  step ${k + 1}: ${JSON.stringify(sentences)}`));
  for (const k of open()) {
    const flat = (j) => parsed[j].flat();
    const setup = (j) => parsed[j][0] ?? [];
    const earlier = [...Array(k).keys()];
    const variants = [
      flat(k),
      [...earlier.flatMap(setup), ...flat(k)],
      [...earlier.flatMap(flat), ...flat(k)],
      ...earlier.flatMap((j) => [[...flat(j), ...flat(k)], [...setup(j), ...flat(k)]]),
      ...parsed[k].flatMap((s, a) => parsed[k].map((t, b) => (a === b ? null : [...earlier.flatMap(setup), ...t, ...s])).filter(Boolean)),
    ];
    const tried = new Set();
    const done = () => !open().includes(k);
    for (const sweep of [false, true]) {
      for (const script of variants) {
        const key = JSON.stringify(script);
        if (done() || !script.length || tried.has(`${sweep}${key}`)) continue;
        tried.add(`${sweep}${key}`);
        if (sweep && variants.indexOf(script) > 2) continue; // the look at other options is slow: only for the step itself and after the earlier steps
        await fresh();
        (await page.evaluate(drive, { ...opts, index: i, mode: 'script', script, sweep })).numbers.forEach((n) => seen.add(n));
      }
    }
  }
}

const results = []; // one entry per simulation
async function check(path, context) {
  const page = await context.newPage();
  await page.addInitScript((seed) => {
    let s = seed >>> 0; // mulberry32, so every run draws the same "random" numbers
    Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }, SEED);
  await page.goto(origin + base + path, { waitUntil: 'load' });
  const count = await page.$$eval('section.playground', (s) => s.map((x) => !!x.querySelector('ol.how')));
  const opts = { settle: SETTLE_MS, settleLooks: SETTLE_LOOKS, maxStates: MAX_STATES, minLabelWord: MIN_LABEL_WORD, presses: PRESSES, randomStates: RANDOM_STATES, randomPressEvery: RANDOM_PRESS_EVERY, randomButtons: RANDOM_BUTTONS };
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
    // Still missing: replay the steps as ordered scripts (see 'parse' in drive), each from a fresh page.
    if (scripts) {
      await fresh();
      const { typed } = await page.evaluate(drive, { ...opts, index: i, mode: 'parse' });
      for (const t of typed) for (const c of claims(out.steps[t.step])) if (c.value === Number(t.value)) console.log(`  typed claim: ${path}#${i} step ${t.step + 1}: ${c.raw} into "${t.label}"`);
    }
    if (open().length) await replay(page, fresh, opts, i, seen, open);
    if (open().length) {
      await fresh();
      (await page.evaluate(drive, { ...opts, index: i, mode: 'buttons' })).numbers.forEach((n) => seen.add(n));
    }
    // Still missing: try random settings of every control, pressing buttons now and then.
    if (open().length) {
      await fresh();
      (await page.evaluate(drive, { ...opts, index: i, mode: 'random', presses: 3 })).numbers.forEach((n) => seen.add(n));
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
  if (verbose) console.log(`${r.key}: ${r.steps.length} steps, ${r.numbers.length} numbers seen, ${missing.length} unverified${missing.length ? ` (${missing.map((m) => m.c.raw).join(', ')})` : ''}`);
}
const stale = Object.entries(baseline).flatMap(([k, list]) => list.filter((n) => !(fresh[k] ?? []).includes(n)).map((n) => `${k}: "${n}"`));

if (update && shard.active) { console.error('--update needs a full run: drop --shard.'); process.exit(2); }
if (update && Object.values(fresh).flat().length > BASELINE_CAP) {
  console.error(`Refusing to write the baseline: ${Object.values(fresh).flat().length} numbers is over the cap of ${BASELINE_CAP}. Confirm each new number by hand in a browser, then raise BASELINE_CAP in scripts/baseline-cap.mjs.`);
  process.exit(1);
}
if (update) {
  writeFileSync(baselinePath, JSON.stringify(Object.fromEntries(Object.entries(fresh).sort(([a], [b]) => a.localeCompare(b))), null, 1) + '\n');
  console.log(`Baseline written: ${Object.keys(fresh).length} simulations, ${Object.values(fresh).flat().length} numbers the check cannot reproduce.`);
  process.exit(0);
}
if (!only && !shard.active) for (const s of stale) console.warn(`warn  baseline entry no longer needed: ${s} (run with --update to tidy)`);
for (const p of problems) console.error(`ERROR ${p}`);
console.log(`checked ${total} numbers in ${results.length} how-to lists: ${problems.length} new unverified, ${Object.values(baseline).flat().length} known unverified in the baseline`);
process.exit(problems.length ? 1 : 0);
