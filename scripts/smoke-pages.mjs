// Loads every built page in a real browser and fails on anything a reader would hit:
// uncaught script errors, console errors, accessibility violations (axe), horizontal scroll at 320px (WCAG reflow, i.e. 400% zoom) with the
// WCAG text-spacing overrides applied,
// and any control inside a playground that throws when set to each of its options.
//
// Usage (after `npm run build`): node scripts/smoke-pages.mjs [--only substring] [--no-axe] [--shard 2/5]
// Needs Playwright (with a Chromium browser: `npx playwright install chromium`) and axe-core; both are pinned in devDependencies. `--font "DejaVu Sans"` forces a wider font to mimic a CI runner or an Android phone.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, relative } from 'node:path';
import { parseShard } from './shard.mjs';

const args = process.argv.slice(2);
const shard = parseShard(args);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
const font = args.includes('--font') ? args[args.indexOf('--font') + 1] : '';
const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'dist');
if (!existsSync(dist)) { console.error('No dist/ folder: run `npm run build` first.'); process.exit(2); }

const load = (id) => {
  for (const base of [root + '/', '/opt/node22/lib/node_modules/']) {
    try { return createRequire(base)(id); } catch { /* try the next place */ }
  }
  return null;
};
const playwright = load('playwright');
if (!playwright) { console.error('Playwright is not installed (npm install --no-save playwright).'); process.exit(2); }
let axeSource = '';
try { axeSource = readFileSync(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8'); } catch {
  // Without axe the accessibility half of this check silently disappears, so a CI run must fail instead of passing quietly.
  console.error('axe-core not found: run `npm install --no-save axe-core` (or pass --no-axe to skip accessibility checks).');
  if (!args.includes('--no-axe')) process.exit(2);
}

// Every built page, as a URL path.
const pages = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name === 'index.html') pages.push('/' + relative(dist, dir).replace(/\\/g, '/') + (dir === dist ? '' : '/'));
  }
})(dist);
pages.sort();
const targets = shard.pick(pages.filter((p) => p.includes(only)));

// Serve dist/ with `astro preview` (our own child process, stopped at the end). The site may live under a base path.
const PORT_BASE = 4400, PORT_SPREAD = 400; // a random port, so parallel runs on one machine do not collide
const port = PORT_BASE + Math.floor(Math.random() * PORT_SPREAD);
const preview = spawn('npx', ['astro', 'preview', '--port', String(port), '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
const stop = () => { try { preview.kill('SIGTERM'); } catch { /* already gone */ } };
process.on('exit', stop);
const origin = `http://127.0.0.1:${port}`;
const START_TRIES = 60, START_POLL_MS = 500; // wait up to 30 s for the preview server
const SERVER_ERROR = 500; // any status below this means the server is up
for (let i = 0; i < START_TRIES; i++) {
  try { if ((await fetch(origin + '/')).status < SERVER_ERROR) break; } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, START_POLL_MS));
}
const base = (() => { try { return new URL(process.env.BASE ? `http://x${process.env.BASE}/` : origin + '/').pathname.replace(/\/$/, ''); } catch { return ''; } })();

// CHROMIUM_PATH points at a Chromium you already have (a sandbox with a different Playwright build); CI downloads its own with `playwright install`.
const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await playwright.chromium.launch({ executablePath });

const CONTROL_TIMEOUT_MS = 500; // a control that does not respond in this time is skipped, not a failure
async function exercise(page) {
  // Set every select to each option and every range to its extremes, then press each playground button once.
  const zones = page.locator('.playground, [data-player], [data-grow]');
  for (let z = 0; z < await zones.count(); z++) {
    const zone = zones.nth(z);
    for (const sel of await zone.locator('select').all()) {
      const values = await sel.locator('option').evaluateAll((o) => o.map((x) => x.value));
      for (const v of values) await sel.selectOption(v, { timeout: CONTROL_TIMEOUT_MS }).catch(() => {});
    }
    for (const r of await zone.locator('input[type=range]').all()) {
      for (const attr of ['min', 'max']) { const v = await r.getAttribute(attr); if (v !== null) await r.fill(v, { timeout: CONTROL_TIMEOUT_MS }).catch(() => {}); }
    }
    for (const btn of await zone.locator('button:not([disabled])').all()) await btn.click({ timeout: CONTROL_TIMEOUT_MS }).catch(() => {});
  }
}

// Two passes per page: a desktop in light mode, and 320 px (a 1280 px screen at 400% zoom, WCAG 1.4.10) in dark mode.
const DESKTOP = 1280, REFLOW = 320, VIEW_HEIGHT = 900;
const LOG_CHARS = 160; // console errors are cut to this length in the report
const MAX_PARALLEL = 6;
const PARALLEL_PAGES = Math.min(MAX_PARALLEL, Math.max(2, availableParallelism())); // one page per core, so a bigger machine is not left idle
async function check(path) {
  const problems = [];
  for (const [width, scheme] of [[DESKTOP, 'light'], [REFLOW, 'dark']]) {
    const page = await browser.newPage({ viewport: { width, height: VIEW_HEIGHT }, colorScheme: scheme });
    page.on('pageerror', (e) => problems.push(`[${width}] script error: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${width}] console error: ${m.text().slice(0, LOG_CHARS)}`); });
    try {
      await page.goto(origin + base + path, { waitUntil: 'load' });
      if (font) await page.addStyleTag({ content: `html, body, button, input, select, textarea { font-family: '${font}', sans-serif !important }` });
      // WCAG 1.4.12: content must survive these user overrides without clipping or sideways scrolling.
      if (width === REFLOW) await page.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important } p { margin-bottom: 2em !important }' });
      await exercise(page);
      if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) problems.push(`[${width}] horizontal scroll`);
      if (axeSource) { // both passes: light at desktop width, and dark at 320px, so both palettes are contrast-checked
        // Let running animations and transitions finish first: a half-faded control reads as low contrast and would fail on a slow runner.
        await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
        await page.addScriptTag({ content: axeSource });
        const res = await page.evaluate(() => axe.run());
        for (const v of res.violations) problems.push(`[${width}] axe ${v.id} x${v.nodes.length}: ${v.nodes[0].target.join(' ').slice(0, 100)}`);
      }
    } catch (e) { problems.push(`[${width}] could not load: ${String(e.message).split('\n')[0]}`); }
    await page.close();
  }
  return problems;
}

// A second attempt rules out a one-off hiccup (a slow runner); a real defect fails twice.
// A first-run failure that then passes is still printed, so an intermittent defect stays visible.
async function checkTwice(path) {
  const first = await check(path);
  if (!first.length) return first;
  const second = await check(path);
  if (!second.length) console.warn(`flaky ${path} (passed on retry)\n  ${first.slice(0, 3).join('\n  ')}`);
  return second;
}

const queue = [...targets];
const failures = [];
await Promise.all(Array.from({ length: PARALLEL_PAGES }, async () => {
  for (let path; (path = queue.shift()); ) {
    const problems = await checkTwice(path);
    if (problems.length) { failures.push({ path, problems }); console.error(`FAIL ${path}\n  ${problems.slice(0, 6).join('\n  ')}`); }
    else console.log(`ok   ${path}`);
  }
}));
await browser.close();
stop();
console.log(`${targets.length - failures.length}/${targets.length} pages clean`);
process.exit(failures.length ? 1 : 0);
