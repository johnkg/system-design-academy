import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createClock, fmt, numberValue, prefersReducedMotion, query, wait, watchVisibility } from '../src/playground.ts';

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

// ---- createClock: the timer life cycle of a running simulation ----
function clockHarness(initiallyWanted: boolean) {
  const { listeners, observers } = stubBrowser();
  g.document.hidden = false;
  mock.timers.enable({ apis: ['setInterval'] });
  const state = { wanted: initiallyWanted, a: 0, b: 0, starts: 0 };
  const clock = createClock({} as Element, () => state.wanted, (every) => { state.starts++; every(() => state.a++, 100); every(() => state.b++, 250); });
  return { state, clock, listeners, observers, scroll: (on: boolean) => observers[0].cb([{ isIntersecting: on }]) };
}

test('createClock: does nothing until it is wanted, then runs every interval on schedule', () => {
  const h = clockHarness(false);
  h.clock();
  mock.timers.tick(1000);
  assert.deepEqual([h.state.a, h.state.b, h.state.starts], [0, 0, 0]);
  h.state.wanted = true; h.clock();
  mock.timers.tick(500);
  assert.deepEqual([h.state.a, h.state.b], [5, 2]);
  mock.timers.reset();
});

test('createClock: calling it again restarts rather than doubling the intervals', () => {
  const h = clockHarness(true);
  h.clock(); h.clock(); h.clock();
  mock.timers.tick(100);
  assert.equal(h.state.a, 1, 'one interval, not three');
  assert.equal(h.state.starts, 3);
  mock.timers.reset();
});

test('createClock: pausing clears every interval', () => {
  const h = clockHarness(true);
  h.clock(); mock.timers.tick(200);
  h.state.wanted = false; h.clock();
  mock.timers.tick(1000);
  assert.deepEqual([h.state.a, h.state.b], [2, 0]);
  mock.timers.reset();
});

test('createClock: stops when scrolled out of view and resumes when scrolled back', () => {
  const h = clockHarness(true);
  h.clock(); mock.timers.tick(100);
  h.scroll(false); assert.equal(h.clock.active(), false);
  mock.timers.tick(1000); assert.equal(h.state.a, 1, 'no ticks while off screen');
  h.scroll(true); assert.equal(h.clock.active(), true);
  mock.timers.tick(100); assert.equal(h.state.a, 2);
  mock.timers.reset();
});

test('createClock: stops when the tab is hidden and resumes when it is shown', () => {
  const h = clockHarness(true);
  h.clock();
  g.document.hidden = true; h.listeners.visibilitychange();
  assert.equal(h.clock.active(), false);
  mock.timers.tick(1000); assert.equal(h.state.a, 0);
  g.document.hidden = false; h.listeners.visibilitychange();
  mock.timers.tick(100); assert.equal(h.state.a, 1);
  mock.timers.reset();
});

test('createClock: a paused simulation stays paused when it scrolls back into view', () => {
  const h = clockHarness(false);
  h.scroll(false); h.scroll(true);
  mock.timers.tick(1000);
  assert.equal(h.state.a, 0);
  mock.timers.reset();
});
