// Shared helpers for the browser scripts inside playgrounds, study Estimators and BreakIt simulations.
// Import them from a plain `<script>` block in an .astro file; Vite bundles them once per page.

/** `q('[data-x]')` finds one element inside `root`. The type argument narrows the result: `q<HTMLInputElement>('[data-rate]')`. */
export const query = (root: ParentNode) => <T extends Element = HTMLElement>(selector: string): T => root.querySelector<T>(selector)!;

/** `val('[data-rate]')` reads the number in a range, number or select control found with `q`. */
export const numberValue = (q: ReturnType<typeof query>) => (selector: string): number => Number(q<HTMLInputElement | HTMLSelectElement>(selector).value);

/** Whole number with thousands separators, the same in every locale so the page and its screenshots agree. */
export const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

export const prefersReducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

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
