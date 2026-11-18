// Runs Lighthouse (mobile settings, the default) on a few representative pages of the built site and fails when a score drops
// below its floor, so the site cannot get slow, inaccessible or badly tagged without a red check.
// The pages are the heaviest kinds on the site: the home page, a concept, a case study, the search page (the whole site's text
// is on it), the review page (every quiz question is on it) and the idea advisor. Floors sit a few points under today's scores
// (see docs/lighthouse.md), because a score moves by a few points from one run to the next.
// Usage (after `npm run build`): node scripts/check-lighthouse.mjs [--only substring] [--verbose]
// Needs Chrome: set CHROME_PATH, or have Google Chrome or Chromium installed. Lighthouse is fetched with npx, pinned below, and is
// not a dependency of the site.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LIGHTHOUSE = 'lighthouse@12.8.2';
// Floors, out of 100. Performance has the most room to move, so its floor is the lowest.
const FLOORS = { performance: 85, accessibility: 95, 'best-practices': 95, seo: 95 };
const PAGES = ['', 'concepts/caching/', 'case-studies/url-shortener/', 'search/', 'review/', 'advisor/'];
const PORT_BASE = 4700, PORT_SPREAD = 200, START_TRIES = 60, START_POLL_MS = 500;

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
const verbose = args.includes('--verbose');
const root = new URL('..', import.meta.url).pathname;
if (!existsSync(join(root, 'dist'))) { console.error('No dist/ folder: run `npm run build` first.'); process.exit(2); }

const freePort = (p) => new Promise((resolve) => { const s = createServer().once('error', () => resolve(false)).listen(p, '127.0.0.1', () => s.close(() => resolve(true))); });
let port = 0;
for (let i = 0; i < PORT_SPREAD && !port; i++) { const p = PORT_BASE + Math.floor(Math.random() * PORT_SPREAD); if (await freePort(p)) port = p; }
if (!port) { console.error('No free port for the preview server.'); process.exit(2); }
const origin = `http://127.0.0.1:${port}`;
const base = process.env.BASE ? process.env.BASE.replace(/\/$/, '') : '';
const preview = spawn('npx', ['astro', 'preview', '--port', String(port), '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
const stop = () => { try { preview.kill('SIGTERM'); } catch { /* already gone */ } };
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(130); });
let up = false;
for (let i = 0; i < START_TRIES && !up; i++) {
  try { up = (await fetch(`${origin}${base}/`)).status < 500; } catch { await new Promise((r) => setTimeout(r, START_POLL_MS)); }
  if (preview.exitCode !== null) break;
}
if (!up) { console.error('The preview server did not start.'); stop(); process.exit(2); }

const out = mkdtempSync(join(tmpdir(), 'lighthouse-'));
const problems = [];
let n = 0;
for (const page of PAGES.filter((p) => p.includes(only))) {
  const file = join(out, `${n++}.json`);
  const run = spawnSync('npx', ['--yes', LIGHTHOUSE, `${origin}${base}/${page}`, '--chrome-flags=--headless=new --no-sandbox', `--only-categories=${Object.keys(FLOORS).join(',')}`, '--output=json', `--output-path=${file}`, '--quiet'], { encoding: 'utf8' });
  if (run.status !== 0 || !existsSync(file)) { problems.push(`/${page}: Lighthouse did not run (${(run.stderr || '').split('\n').find(Boolean) ?? `exit ${run.status}`})`); continue; }
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const scores = Object.fromEntries(Object.keys(FLOORS).map((k) => [k, Math.round(report.categories[k].score * 100)]));
  const a = report.audits;
  console.log(`/${page}`.padEnd(32), Object.entries(scores).map(([k, v]) => `${k} ${v}`).join('  '), verbose ? `| LCP ${a['largest-contentful-paint'].displayValue}, TBT ${a['total-blocking-time'].displayValue}, CLS ${a['cumulative-layout-shift'].displayValue}` : '');
  for (const [k, floor] of Object.entries(FLOORS)) if (scores[k] < floor) problems.push(`/${page}: ${k} is ${scores[k]}, below its floor of ${floor}`);
}
rmSync(out, { recursive: true, force: true });
stop();
for (const p of problems) console.error(`ERROR ${p}`);
console.log(`checked ${n} pages: ${problems.length} below their floor`);
process.exit(problems.length ? 1 : 0);
