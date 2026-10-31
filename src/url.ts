// Site-relative URLs. Kept apart from lib.ts (which uses Vite-only globs) so plain Node can import it in unit tests.

/** The deploy base path without a trailing slash ('' locally, '/system-design-academy' on GitHub Pages). */
export const base = (import.meta.env?.BASE_URL ?? '/').replace(/\/$/, '');
export const url = (path: string) => `${base}/${path.replace(/^\//, '')}`;
