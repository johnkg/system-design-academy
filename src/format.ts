// Pure page helpers (reading time, section numbering). Kept apart from lib.ts so plain Node can import them in unit tests.

// How long a page takes: the words on it at reading speed, plus time for its simulation and quiz.
const READ_WPM = 200;
const TRY_MINUTES = 3; // simulation and quiz on a concept or pattern page
const TRY_MINUTES_STUDY = 8; // the estimator, the break-it widget and the quiz on a case study
export const words = (v: unknown): number =>
  typeof v === 'string' ? v.split(/\s+/).filter(Boolean).length
  : Array.isArray(v) ? v.reduce((n: number, x) => n + words(x), 0)
  : v && typeof v === 'object' ? Object.entries(v).reduce((n, [k, x]) => n + (['slug', 'href', 'answer', 'pick'].includes(k) ? 0 : words(x)), 0)
  : 0;
export const minutesFor = (kind: string, data: unknown) => Math.ceil(words(data) / READ_WPM) + (kind === 'study' ? TRY_MINUTES_STUDY : TRY_MINUTES);

/** Two-digit section number for lesson headings ("01"). */
export const pad = (n: number) => String(n).padStart(2, '0');

export interface Section { id: string; label: string; num: string }
/** Number the sections that exist on this page, in order; falsy entries (a part this page lacks) are skipped. */
export const numbered = (list: (readonly [string, string] | false | undefined | null)[]): Section[] =>
  list.filter((x): x is readonly [string, string] => !!x).map(([id, label], i) => ({ id, label, num: pad(i + 1) }));
