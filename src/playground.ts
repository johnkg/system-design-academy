// Shared helpers for the browser scripts inside playgrounds, study Estimators and BreakIt simulations.
// Import them from a plain `<script>` block in an .astro file; Vite bundles them once per page.

/** `q('[data-x]')` finds one element inside `root`. The type argument narrows the result: `q<HTMLInputElement>('[data-rate]')`. */
export const query = (root: ParentNode) => <T extends Element = HTMLElement>(selector: string): T => root.querySelector<T>(selector)!;

/** `val('[data-rate]')` reads the number in a range, number or select control found with `q`. */
export const numberValue = (q: ReturnType<typeof query>) => (selector: string): number => Number(q<HTMLInputElement | HTMLSelectElement>(selector).value);

const LOCALE = 'en-US'; // fixed, so the page and its screenshots agree whatever the reader's locale
const ADAPTIVE_ROUNDING_THRESHOLD = 100; // from here up, decimals are noise

/** Rounded to a whole number, with thousands separators: 1234.6 becomes "1,235". */
export const formatWholeNumber = (n: number): string => Math.round(n).toLocaleString(LOCALE);

/** Thousands separators only, nothing rounded: for values that are already whole numbers. */
export const formatThousands = (n: number): string => n.toLocaleString(LOCALE);

/** One decimal below 100, a whole number from 100 up, with thousands separators: 42.37 becomes "42.4", 1234.6 becomes "1,235". */
export const formatOneDecimalBelow100 = (n: number): string =>
  (n >= ADAPTIVE_ROUNDING_THRESHOLD ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString(LOCALE);

export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const prefersReducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

const MULBERRY32_INCREMENT = 0x6d2b79f5; // the generator's fixed step through its 32-bit state
const UINT32_RANGE = 2 ** 32; // 4294967296, so a 32-bit unsigned result divides down to [0, 1)

/** Seeded random numbers in [0, 1): the same seed always gives the same sequence, so a simulation replays identically (mulberry32). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + MULBERRY32_INCREMENT) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

/** Resolves after `ms`, or at once when the reader asked for reduced motion. */
export const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, prefersReducedMotion() ? 0 : ms));

/**
 * Tells a simulation when to run its timers. `update(onScreen)` is called when `root` scrolls into or out of view and when the
 * tab is hidden or shown again; check `document.hidden` as well as `onScreen` before starting a timer, and stop it otherwise.
 */
export function watchVisibility(root: Element, update: (onScreen: boolean) => void): void {
  let onScreen = true; // assume visible until the observer says otherwise
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver((entries) => { onScreen = entries[entries.length - 1].isIntersecting; update(onScreen); }).observe(root);
  }
  document.addEventListener('visibilitychange', () => update(onScreen));
}

/**
 * A repeating timer that runs only while the simulation wants it AND `root` is on screen AND the tab is visible.
 * `setWanted(true)` is "Run was pressed"; `setWanted(false)` is "paused or finished". Replaces the usual hand-kept
 * timer id, on-screen flag and clock() function.
 */
export function createTicker(root: Element, onTick: () => void, intervalMs: number): { setWanted: (wanted: boolean) => void } {
  let wanted = false;
  let onScreen = true;
  let timerId: number | undefined;
  const sync = () => {
    window.clearInterval(timerId);
    timerId = undefined;
    if (wanted && onScreen && !document.hidden) timerId = window.setInterval(onTick, intervalMs);
  };
  watchVisibility(root, (visible) => { onScreen = visible; sync(); });
  return { setWanted: (value) => { wanted = value; sync(); } };
}
