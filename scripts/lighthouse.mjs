// Runs Lighthouse (mobile preset: slow 4G, 4x CPU slowdown) on a few representative built pages and compares the category scores
// with scripts/lighthouse-budgets.json. A category listed in `failOn` fails the run when it is under budget; the others (performance,
// which moves with the runner's CPU) only print a warning, unless `--strict` makes every category fail.
// Budgets sit a little under what the site scores today: they catch a real regression (a big script, a missing alt text, a
// lost meta tag), not noise.
//
// Usage (after `npm run build`): node scripts/lighthouse.mjs [--strict] [--only substring]
// Needs a Chromium: set CHROME_PATH (or CHROMIUM_PATH), or run `npx playwright install chromium` and it is found through Playwright.
// Lighthouse itself is fetched with npx at the pinned version below, so it is not part of `npm ci` for every job.
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LIGHTHOUSE = 'lighthouse@12.8.2';
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
const root = new URL('..', import.meta.url).pathname;
if (!existsSync(join(root, 'dist'))) { console.error('No dist/ folder: run `npm run build` first.'); process.exit(2); }
const { pages, budgets, failOn = [] } = JSON.parse(readFileSync(join(root, 'scripts/lighthouse-budgets.json'), 'utf8'));

let chrome = process.env.CHROME_PATH || process.env.CHROMIUM_PATH;
if (!chrome) {
  try { chrome = createRequire(root + '/')('playwright').chromium.executablePath(); } catch { /* no Playwright */ }
}
if (!chrome || !existsSync(chrome)) { console.error('No Chromium found: set CHROME_PATH or run `npx playwright install chromium`.'); process.exit(2); }

const PORT_BASE = 5200, PORT_SPREAD = 300; // a random port, so parallel runs on one machine do not collide
const port = PORT_BASE + Math.floor(Math.random() * PORT_SPREAD);
const preview = spawn('npx', ['astro', 'preview', '--port', String(port), '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
const stop = () => { try { preview.kill('SIGTERM'); } catch { /* already gone */ } };
process.on('exit', stop);
const origin = `http://127.0.0.1:${port}`;
const START_TRIES = 60, START_POLL_MS = 500, SERVER_ERROR = 500;
for (let i = 0; i < START_TRIES; i++) {
  try { if ((await fetch(origin + '/')).status < SERVER_ERROR) break; } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, START_POLL_MS));
}
// The site may live under a base path (GitHub Pages); preview serves it there.
const base = process.env.BASE && process.env.BASE !== '/' ? process.env.BASE.replace(/\/$/, '') : '';

const out = mkdtempSync(join(tmpdir(), 'lighthouse-'));
const categories = Object.keys(budgets);
const SCORE_SCALE = 100;
const problems = []; // { text, fatal }
let ran = 0;
for (const path of pages.filter((p) => p.includes(only))) {
  const file = join(out, `${path.replace(/\W+/g, '_')}.json`);
  try {
    execFileSync('npx', ['--yes', LIGHTHOUSE, origin + base + path, '--output=json', `--output-path=${file}`, '--quiet',
      `--only-categories=${categories.join(',')}`, '--chrome-flags=--headless=new --no-sandbox'],
    { env: { ...process.env, CHROME_PATH: chrome }, stdio: ['ignore', 'ignore', 'inherit'] });
  } catch (e) { problems.push({ text: `${path}: Lighthouse did not run (${String(e.message).split('\n')[0]})`, fatal: true }); continue; }
  const lhr = JSON.parse(readFileSync(file, 'utf8'));
  const scores = Object.fromEntries(categories.map((c) => [c, Math.round((lhr.categories[c]?.score ?? 0) * SCORE_SCALE)]));
  ran++;
  console.log(`${path.padEnd(32)} ${categories.map((c) => `${c} ${scores[c]}`).join('  ')}`);
  for (const c of categories) if (scores[c] < budgets[c]) problems.push({ text: `${path}: ${c} ${scores[c]} is under the budget of ${budgets[c]}`, fatal: strict || failOn.includes(c) });
}
stop();
for (const p of problems) (p.fatal ? console.error : console.warn)(`${p.fatal ? 'ERROR' : 'warn '} ${p.text}`);
const fatal = problems.filter((p) => p.fatal).length;
console.log(`${ran} page(s) audited, ${fatal} failing, ${problems.length - fatal} warning(s)`);
process.exit(fatal ? 1 : 0);
