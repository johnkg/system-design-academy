// Loads every built page in a real browser and fails on anything a reader would hit:
// uncaught script errors, console errors, accessibility violations (axe), horizontal scroll on a phone,
// and any control inside a playground that throws when set to each of its options.
//
// Usage (after `npm run build`): node scripts/smoke-pages.mjs [--only substring] [--no-axe]
// Needs Playwright with a Chromium browser. CI installs it with `npm install --no-save playwright`;
// it is deliberately not a dependency of the site.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
const useAxe = !args.includes('--no-axe');
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
try { axeSource = readFileSync(join(root, 'node_modules/axe-core/axe.min.js'), 'utf8'); } catch { console.warn('! axe-core not found: accessibility checks skipped'); }

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
const targets = pages.filter((p) => p.includes(only));

// Serve dist/ with `astro preview` (our own child process, stopped at the end). The site may live under a base path.
const port = 4400 + Math.floor(Math.random() * 400);
const preview = spawn('npx', ['astro', 'preview', '--port', String(port), '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
const stop = () => { try { preview.kill('SIGTERM'); } catch { /* already gone */ } };
process.on('exit', stop);
const origin = `http://127.0.0.1:${port}`;
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(origin + '/')).status < 500) break; } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 500));
}
const base = (() => { try { return new URL(process.env.BASE ? `http://x${process.env.BASE}/` : origin + '/').pathname.replace(/\/$/, ''); } catch { return ''; } })();

const executablePath = existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined;
const browser = await playwright.chromium.launch({ executablePath });

async function exercise(page) {
  // Set every select to each option and every range to its extremes, then press each playground button once.
  const zones = page.locator('.playground, [data-player], [data-grow]');
  for (let z = 0; z < await zones.count(); z++) {
    const zone = zones.nth(z);
    for (const sel of await zone.locator('select').all()) {
      const values = await sel.locator('option').evaluateAll((o) => o.map((x) => x.value));
      for (const v of values) await sel.selectOption(v, { timeout: 500 }).catch(() => {});
    }
    for (const r of await zone.locator('input[type=range]').all()) {
      for (const attr of ['min', 'max']) { const v = await r.getAttribute(attr); if (v !== null) await r.fill(v, { timeout: 500 }).catch(() => {}); }
    }
    for (const btn of await zone.locator('button:not([disabled])').all()) await btn.click({ timeout: 500 }).catch(() => {});
  }
}

async function check(path) {
  const problems = [];
  for (const [width, scheme] of [[1280, 'light'], [375, 'dark']]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: scheme });
    page.on('pageerror', (e) => problems.push(`[${width}] script error: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${width}] console error: ${m.text().slice(0, 160)}`); });
    try {
      await page.goto(origin + base + path, { waitUntil: 'load' });
      await exercise(page);
      if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) problems.push(`[${width}] horizontal scroll`);
      if (axeSource && width === 1280) {
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
async function checkTwice(path) {
  const first = await check(path);
  return first.length ? check(path) : first;
}

const queue = [...targets];
const failures = [];
await Promise.all(Array.from({ length: 4 }, async () => {
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
