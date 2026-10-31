import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fmt, mulberry32, numberValue, prefersReducedMotion, query, wait, watchVisibility } from '../src/playground.ts';

const g = globalThis as any;
const saved: Record<string, unknown> = {};
beforeEach(() => { for (const k of ['matchMedia', 'IntersectionObserver', 'document']) saved[k] = g[k]; });
afterEach(() => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete g[k]; else g[k] = saved[k]; } });

const fakeRoot = (map: Record<string, any>) => ({ querySelector: (s: string) => map[s] ?? null }) as any;

test('query finds an element inside the root by selector', () => {
  const el = { id: 'x' };
  assert.equal(query(fakeRoot({ '[data-a]': el }))('[data-a]'), el);
});

test('numberValue reads a control as a number', () => {
  const q = query(fakeRoot({ '[data-rate]': { value: '2500' }, '[data-pick]': { value: '3.5' }, '[data-empty]': { value: '' } }));
  const val = numberValue(q);
  assert.equal(val('[data-rate]'), 2500);
  assert.equal(val('[data-pick]'), 3.5);
  assert.equal(val('[data-empty]'), 0);
});

test('fmt rounds and uses en-US thousands separators whatever the locale', () => {
  assert.equal(fmt(1234567.6), '1,234,568');
  assert.equal(fmt(0.4), '0');
  assert.equal(fmt(-1500), '-1,500');
  assert.equal(fmt(999), '999');
});

test('prefersReducedMotion follows the media query', () => {
  g.matchMedia = (q: string) => ({ matches: q === '(prefers-reduced-motion: reduce)' });
  assert.equal(prefersReducedMotion(), true);
  g.matchMedia = () => ({ matches: false });
  assert.equal(prefersReducedMotion(), false);
});

test('wait skips the delay when the reader asked for reduced motion, and waits otherwise', async () => {
  g.matchMedia = () => ({ matches: true });
  let t = Date.now(); await wait(300); assert.ok(Date.now() - t < 100, 'no delay with reduced motion');
  g.matchMedia = () => ({ matches: false });
  t = Date.now(); await wait(60); assert.ok(Date.now() - t >= 50, 'delays by about the requested time');
});

function stubBrowser() {
  const listeners: Record<string, () => void> = {};
  g.document = { addEventListener: (name: string, fn: () => void) => { listeners[name] = fn; } };
  const observers: { cb: (e: { isIntersecting: boolean }[]) => void; target?: unknown }[] = [];
  g.IntersectionObserver = class { cb: any; constructor(cb: any) { this.cb = cb; observers.push(this as any); } observe(t: unknown) { (this as any).target = t; } };
  return { listeners, observers };
}

test('watchVisibility reports scroll in/out of view and tab visibility with the last known on-screen state', () => {
  const { listeners, observers } = stubBrowser();
  const calls: boolean[] = [];
  const root = {} as Element;
  watchVisibility(root, (on) => calls.push(on));
  assert.equal(observers.length, 1);
  assert.equal((observers[0] as any).target, root);
  observers[0].cb([{ isIntersecting: false }]);
  listeners.visibilitychange();
  observers[0].cb([{ isIntersecting: false }, { isIntersecting: true }]); // the newest entry wins
  listeners.visibilitychange();
  assert.deepEqual(calls, [false, false, true, true]);
});

test('watchVisibility assumes "on screen" when IntersectionObserver is missing, and still reports tab changes', () => {
  const { listeners } = stubBrowser();
  delete g.IntersectionObserver;
  const calls: boolean[] = [];
  watchVisibility({} as Element, (on) => calls.push(on));
  listeners.visibilitychange();
  assert.deepEqual(calls, [true]);
});

test('mulberry32 replays the same sequence for a seed and stays inside [0, 1)', () => {
  const first = mulberry32(42), again = mulberry32(42);
  const draws = Array.from({ length: 1000 }, () => first());
  assert.deepEqual(draws, Array.from({ length: 1000 }, () => again()));
  assert.ok(draws.every((x) => x >= 0 && x < 1));
  assert.notDeepEqual(draws.slice(0, 5), Array.from({ length: 5 }, mulberry32(43)));
});

test('mulberry32 gives the reference values the simulations were tuned against', () => {
  // Pinned from the copies this function replaced; a change here shifts every number quoted in the lesson text.
  assert.deepEqual(Array.from({ length: 3 }, mulberry32(1)).map((x) => x.toFixed(6)), ['0.627074', '0.002736', '0.527447']);
});
